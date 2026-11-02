package com.example.hubmind.data.repository

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.BatteryManager
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.example.hubmind.agent.AndroidActionType
import com.example.hubmind.agent.AndroidAppLauncher
import com.example.hubmind.agent.AndroidCommand
import com.example.hubmind.agent.AndroidUiActionExecutor
import com.example.hubmind.agent.HubMindAccessibilityService
import com.example.hubmind.data.model.*
import com.example.hubmind.data.remote.HubMindBackendClient
import com.example.hubmind.data.remote.JessFunctionCall
import com.example.hubmind.data.transport.CommandEnvelope
import com.example.hubmind.data.transport.HubMindControlPlaneTransport
import com.example.hubmind.data.transport.KeystorePairingManager
import com.example.hubmind.voice.GeminiLiveAudioSession
import com.example.hubmind.voice.GeminiLiveCallbacks
import com.example.hubmind.voice.JessCanonicalConfig
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject
import java.net.Inet4Address
import java.net.NetworkInterface
import java.time.Instant
import java.util.UUID

class AuthRepositoryImpl(
    private val backendClient: HubMindBackendClient? = null,
    private val onUserAuthenticated: ((User) -> Unit)? = null
) : AuthRepository {

    companion object {
        val BOOTSTRAP_ADMIN_EMAILS = setOf(
            "johnrufai242@gmail.com",
            "rufaijohnny@gmail.com"
        )
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _currentUser = MutableStateFlow<User?>(null)
    override val currentUser: StateFlow<User?> = _currentUser.asStateFlow()

    private val _isSessionValid = MutableStateFlow(false)
    override val isSessionValid: StateFlow<Boolean> = _isSessionValid.asStateFlow()

    init {
        if (backendClient != null) {
            scope.launch {
                restoreExistingSession()
            }
        }
    }

    private suspend fun restoreExistingSession() {
        val client = backendClient ?: return
        val auth = client.getFirebaseAuth().getOrNull() ?: return
        val fbUser = auth.currentUser ?: return
        val loaded = loadAndValidateFirestoreUser(
            uid = fbUser.uid,
            email = fbUser.email ?: "",
            displayName = fbUser.displayName ?: ""
        )
        loaded.onSuccess { user ->
            _currentUser.value = user
            _isSessionValid.value = true
            onUserAuthenticated?.invoke(user)
        }.onFailure {
            runCatching { auth.signOut() }
            _currentUser.value = null
            _isSessionValid.value = false
        }
    }

    private suspend fun loadAndValidateFirestoreUser(
        uid: String,
        email: String,
        displayName: String
    ): Result<User> = runCatching {
        val normalizedEmail = email.trim().lowercase()
        val isBootstrapAdmin = normalizedEmail in BOOTSTRAP_ADMIN_EMAILS
        val client = backendClient
            ?: return@runCatching User(
                id = uid,
                email = normalizedEmail,
                displayName = displayName.ifBlank {
                    if (isBootstrapAdmin) "John Rufai" else normalizedEmail.substringBefore("@").replaceFirstChar { it.uppercase() }
                },
                preferredName = if (isBootstrapAdmin) "Johnny" else "",
                role = if (isBootstrapAdmin) "admin" else "staff",
                status = "active",
                lastSeenAt = Instant.now().toString()
            )

        val db = client.getFirebaseFirestore().getOrThrow()
        val userRef = db.collection("users").document(uid)
        val snap = userRef.get().await()
        val nowIso = Instant.now().toString()

        if (!snap.exists()) {
            if (!isBootstrapAdmin) {
                throw IllegalStateException(
                    "This account has not been authorized for Hub-Mind. Ask an administrator for an invitation."
                )
            }
            val defaultName = displayName.ifBlank { "John Rufai" }
            val newDoc = mapOf(
                "id" to uid,
                "email" to normalizedEmail,
                "name" to defaultName,
                "displayName" to defaultName,
                "preferredName" to "Johnny",
                "role" to "admin",
                "status" to "active",
                "createdAt" to nowIso,
                "approvedAt" to nowIso,
                "defaultVisibility" to "workspace",
                "lastSeenAt" to nowIso
            )
            userRef.set(newDoc, SetOptions.merge()).await()
            return@runCatching User(
                id = uid,
                email = normalizedEmail,
                displayName = defaultName,
                preferredName = "Johnny",
                role = "admin",
                status = "active",
                lastSeenAt = nowIso
            )
        }

        val status = (snap.getString("status") ?: "active").lowercase()
        if (status != "active") {
            throw IllegalStateException("Your Hub-Mind account status is '$status'. Active status is required.")
        }

        val roleFromDoc = (snap.getString("role") ?: "staff").lowercase()
        val effectiveRole = if (isBootstrapAdmin) "admin" else roleFromDoc
        val nameFromDoc = snap.getString("displayName")?.takeIf { it.isNotBlank() }
            ?: displayName.ifBlank { normalizedEmail.substringBefore("@") }
        val preferredFromDoc = snap.getString("preferredName") ?: ""

        runCatching {
            userRef.update("lastSeenAt", nowIso).await()
        }

        User(
            id = uid,
            email = snap.getString("email")?.ifBlank { normalizedEmail } ?: normalizedEmail,
            displayName = nameFromDoc,
            preferredName = preferredFromDoc,
            role = effectiveRole,
            status = status,
            photoUrl = snap.getString("photoUrl"),
            phone = snap.getString("phone"),
            lastSeenAt = nowIso
        )
    }

    override suspend fun signIn(email: String, password: String): Result<User> {
        val normalized = email.trim().lowercase()
        if (normalized.isBlank() || password.isBlank()) {
            return Result.failure(IllegalArgumentException("Email and password are required."))
        }

        // Unit-test deterministic path when no Android Context / HubMindBackendClient is attached
        val client = backendClient
        if (client == null) {
            val isAdmin = normalized in BOOTSTRAP_ADMIN_EMAILS
            val user = User(
                id = "usr-" + UUID.randomUUID().toString().take(8),
                email = normalized,
                displayName = if (isAdmin) "John Rufai" else normalized.substringBefore("@").replaceFirstChar { it.uppercase() },
                preferredName = if (isAdmin) "Johnny" else "",
                role = if (isAdmin) "admin" else "staff",
                status = "active",
                lastSeenAt = Instant.now().toString()
            )
            _currentUser.value = user
            _isSessionValid.value = true
            onUserAuthenticated?.invoke(user)
            return Result.success(user)
        }

        return runCatching {
            val auth = client.getFirebaseAuth().getOrThrow()
            val authResult = auth.signInWithEmailAndPassword(normalized, password).await()
            val fbUser = authResult.user
                ?: throw IllegalStateException("Firebase Authentication returned no user.")
            val profile = loadAndValidateFirestoreUser(
                uid = fbUser.uid,
                email = fbUser.email ?: normalized,
                displayName = fbUser.displayName ?: ""
            ).getOrElse { err ->
                runCatching { auth.signOut() }
                throw err
            }
            _currentUser.value = profile
            _isSessionValid.value = true
            onUserAuthenticated?.invoke(profile)
            profile
        }
    }

    override suspend fun signInWithGoogle(idToken: String): Result<User> {
        if (idToken.isBlank() || idToken == "mock-google-token") {
            return Result.failure(
                IllegalArgumentException(
                    "A valid Google ID token is required. Fake or placeholder Google tokens are rejected."
                )
            )
        }

        val client = backendClient
            ?: return Result.failure(IllegalStateException("Backend client is not configured for Google Sign-In."))

        return runCatching {
            val auth = client.getFirebaseAuth().getOrThrow()
            val credential = GoogleAuthProvider.getCredential(idToken, null)
            val authResult = auth.signInWithCredential(credential).await()
            val fbUser = authResult.user
                ?: throw IllegalStateException("Google Sign-In succeeded but returned no Firebase user.")
            val profile = loadAndValidateFirestoreUser(
                uid = fbUser.uid,
                email = fbUser.email ?: "",
                displayName = fbUser.displayName ?: ""
            ).getOrElse { err ->
                runCatching { auth.signOut() }
                throw err
            }
            _currentUser.value = profile
            _isSessionValid.value = true
            onUserAuthenticated?.invoke(profile)
            profile
        }
    }

    override suspend fun signOut() {
        runCatching {
            backendClient?.getFirebaseAuth()?.getOrNull()?.signOut()
        }
        _currentUser.value = null
        _isSessionValid.value = false
    }

    override suspend fun checkHealth(): Boolean {
        val client = backendClient ?: return true
        return client.fetchAndValidateRuntimeConfig().isSuccess
    }
}

class ConversationRepositoryImpl(
    private val backendClient: HubMindBackendClient? = null
) : ConversationRepository {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val defaultTestConv = Conversation(
        id = "conv-initial-session",
        title = "Hub-Mind Operations",
        summary = "Active workspace session",
        messageCount = 0,
        createdAt = System.currentTimeMillis(),
        updatedAt = System.currentTimeMillis(),
        isLiveSession = false
    )

    private val _conversations = MutableStateFlow<List<Conversation>>(
        if (backendClient == null) listOf(defaultTestConv) else emptyList()
    )
    override val conversations: StateFlow<List<Conversation>> = _conversations.asStateFlow()

    private val _currentConversation = MutableStateFlow<Conversation?>(
        if (backendClient == null) defaultTestConv else null
    )
    override val currentConversation: StateFlow<Conversation?> = _currentConversation.asStateFlow()

    private val messagesMap = mutableMapOf<String, MutableStateFlow<List<ChatMessage>>>()
    private val messageListeners = mutableMapOf<String, ListenerRegistration>()
    private var conversationsListener: ListenerRegistration? = null
    private var memoriesListener: ListenerRegistration? = null
    private var boundUserId: String? = null

    private val _userMemories = MutableStateFlow<List<UserMemory>>(emptyList())
    val userMemories: StateFlow<List<UserMemory>> = _userMemories.asStateFlow()

    fun bindToUser(userId: String) {
        if (boundUserId == userId && conversationsListener != null) return
        boundUserId = userId
        val client = backendClient ?: return

        scope.launch {
            val db = client.getFirebaseFirestore().getOrNull() ?: return@launch
            conversationsListener?.remove()
            conversationsListener = db.collection("users")
                .document(userId)
                .collection("conversations")
                .orderBy("updatedAt", Query.Direction.DESCENDING)
                .addSnapshotListener { snap, err ->
                    if (err != null || snap == null) return@addSnapshotListener
                    val loaded = snap.documents.map { doc ->
                        val createdRaw = doc.get("createdAt")
                        val updatedRaw = doc.get("updatedAt")
                        val createdMs = when (createdRaw) {
                            is Number -> createdRaw.toLong()
                            is String -> runCatching { Instant.parse(createdRaw).toEpochMilli() }.getOrDefault(System.currentTimeMillis())
                            else -> System.currentTimeMillis()
                        }
                        val updatedMs = when (updatedRaw) {
                            is Number -> updatedRaw.toLong()
                            is String -> runCatching { Instant.parse(updatedRaw).toEpochMilli() }.getOrDefault(createdMs)
                            else -> createdMs
                        }
                        Conversation(
                            id = doc.id,
                            title = doc.getString("title") ?: "Jess Conversation",
                            summary = doc.getString("summary") ?: "",
                            messageCount = (doc.getLong("messageCount") ?: 0L).toInt(),
                            createdAt = createdMs,
                            updatedAt = updatedMs,
                            isLiveSession = doc.getBoolean("isLiveSession") ?: false
                        )
                    }
                    _conversations.value = loaded
                    if (_currentConversation.value == null && loaded.isNotEmpty()) {
                        _currentConversation.value = loaded.first()
                        attachMessageListener(userId, loaded.first().id)
                    } else if (loaded.isEmpty()) {
                        scope.launch {
                            createConversation("Hub-Mind Operations")
                        }
                    }
                }

            memoriesListener?.remove()
            memoriesListener = db.collection("users")
                .document(userId)
                .collection("memories")
                .addSnapshotListener { snap, err ->
                    if (err != null || snap == null) return@addSnapshotListener
                    val mems = snap.documents.mapNotNull { doc ->
                        val content = doc.getString("content") ?: doc.getString("value") ?: return@mapNotNull null
                        val catStr = (doc.getString("category") ?: "FACT").uppercase()
                        val cat = runCatching { MemoryCategory.valueOf(catStr) }.getOrDefault(MemoryCategory.FACT)
                        UserMemory(
                            id = doc.id,
                            userId = userId,
                            content = content,
                            category = cat,
                            importance = doc.getString("importance") ?: "medium",
                            key = doc.getString("key"),
                            createdAt = doc.getString("createdAt") ?: ""
                        )
                    }
                    _userMemories.value = mems
                }
        }
    }

    private fun attachMessageListener(userId: String, conversationId: String) {
        if (messageListeners.containsKey(conversationId)) return
        val client = backendClient ?: return
        scope.launch {
            val db = client.getFirebaseFirestore().getOrNull() ?: return@launch
            val reg = db.collection("users")
                .document(userId)
                .collection("conversations")
                .document(conversationId)
                .collection("messages")
                .orderBy("timestamp", Query.Direction.ASCENDING)
                .addSnapshotListener { snap, err ->
                    if (err != null || snap == null) return@addSnapshotListener
                    val msgs = snap.documents.map { doc ->
                        val roleStr = (doc.getString("role") ?: doc.getString("sender") ?: "user").lowercase()
                        val sender = if (roleStr == "model" || roleStr == "assistant" || roleStr == "jess") {
                            MessageSender.JESS
                        } else {
                            MessageSender.USER
                        }
                        val tsRaw = doc.get("timestamp") ?: doc.get("createdAt")
                        val ts = when (tsRaw) {
                            is Number -> tsRaw.toLong()
                            is String -> runCatching { Instant.parse(tsRaw).toEpochMilli() }.getOrDefault(System.currentTimeMillis())
                            else -> System.currentTimeMillis()
                        }
                        ChatMessage(
                            id = doc.id,
                            sender = sender,
                            text = doc.getString("text") ?: doc.getString("content") ?: "",
                            timestamp = ts,
                            targetDeviceId = doc.getString("targetDeviceId"),
                            toolCallName = doc.getString("toolCallName"),
                            toolCallArgs = doc.getString("toolCallArgs"),
                            executionStatus = doc.getString("executionStatus")
                        )
                    }
                    messagesMap.getOrPut(conversationId) { MutableStateFlow(emptyList()) }.value = msgs
                }
            messageListeners[conversationId] = reg
        }
    }

    override fun getMessages(conversationId: String): Flow<List<ChatMessage>> {
        boundUserId?.let { attachMessageListener(it, conversationId) }
        return messagesMap.getOrPut(conversationId) { MutableStateFlow(emptyList()) }.asStateFlow()
    }

    override suspend fun selectConversation(conversationId: String) {
        val found = _conversations.value.find { it.id == conversationId }
        if (found != null) {
            _currentConversation.value = found
            boundUserId?.let { attachMessageListener(it, conversationId) }
        }
    }

    override suspend fun createConversation(title: String): Conversation {
        val now = System.currentTimeMillis()
        val newConv = Conversation(
            id = "conv-" + UUID.randomUUID().toString().take(8),
            title = title.ifBlank { "New Jess Conversation" },
            summary = "Active Hub-Mind conversation",
            messageCount = 0,
            createdAt = now,
            updatedAt = now
        )
        _conversations.value = listOf(newConv) + _conversations.value.filter { it.id != newConv.id }
        _currentConversation.value = newConv
        messagesMap.getOrPut(newConv.id) { MutableStateFlow(emptyList()) }

        val uid = boundUserId
        val db = backendClient?.getFirebaseFirestore()?.getOrNull()
        if (uid != null && db != null) {
            runCatching {
                db.collection("users")
                    .document(uid)
                    .collection("conversations")
                    .document(newConv.id)
                    .set(
                        mapOf(
                            "title" to newConv.title,
                            "summary" to newConv.summary,
                            "messageCount" to 0,
                            "createdAt" to now,
                            "updatedAt" to now,
                            "isLiveSession" to false
                        ),
                        SetOptions.merge()
                    )
                    .await()
            }
            attachMessageListener(uid, newConv.id)
        }
        return newConv
    }

    override suspend fun postUserMessage(
        conversationId: String,
        text: String,
        targetDeviceId: String?
    ): ChatMessage {
        val now = System.currentTimeMillis()
        val msg = ChatMessage(
            id = "msg-" + UUID.randomUUID().toString().take(8),
            sender = MessageSender.USER,
            text = text,
            timestamp = now,
            targetDeviceId = targetDeviceId
        )
        val flow = messagesMap.getOrPut(conversationId) { MutableStateFlow(emptyList()) }
        flow.value = flow.value + msg

        val uid = boundUserId
        val db = backendClient?.getFirebaseFirestore()?.getOrNull()
        if (uid != null && db != null) {
            val convRef = db.collection("users").document(uid).collection("conversations").document(conversationId)
            runCatching {
                convRef.collection("messages").document(msg.id).set(
                    mapOf(
                        "role" to "user",
                        "sender" to "USER",
                        "text" to text,
                        "content" to text,
                        "timestamp" to now,
                        "createdAt" to Instant.ofEpochMilli(now).toString(),
                        "targetDeviceId" to targetDeviceId
                    )
                ).await()
                convRef.set(
                    mapOf(
                        "updatedAt" to now,
                        "summary" to text.take(120)
                    ),
                    SetOptions.merge()
                ).await()
            }
        }
        return msg
    }

    override suspend fun appendJessResponse(
        conversationId: String,
        text: String,
        toolName: String?,
        status: String?
    ): ChatMessage {
        val now = System.currentTimeMillis()
        val msg = ChatMessage(
            id = "msg-" + UUID.randomUUID().toString().take(8),
            sender = MessageSender.JESS,
            text = text,
            timestamp = now,
            toolCallName = toolName,
            executionStatus = status
        )
        val flow = messagesMap.getOrPut(conversationId) { MutableStateFlow(emptyList()) }
        flow.value = flow.value + msg

        val uid = boundUserId
        val db = backendClient?.getFirebaseFirestore()?.getOrNull()
        if (uid != null && db != null) {
            val convRef = db.collection("users").document(uid).collection("conversations").document(conversationId)
            runCatching {
                convRef.collection("messages").document(msg.id).set(
                    mapOf(
                        "role" to "model",
                        "sender" to "JESS",
                        "text" to text,
                        "content" to text,
                        "timestamp" to now,
                        "createdAt" to Instant.ofEpochMilli(now).toString(),
                        "toolCallName" to toolName,
                        "executionStatus" to status
                    )
                ).await()
                convRef.set(
                    mapOf(
                        "updatedAt" to now,
                        "summary" to text.take(120)
                    ),
                    SetOptions.merge()
                ).await()
            }
        }
        return msg
    }

    suspend fun saveMemory(key: String?, content: String, category: String = "FACT") {
        val uid = boundUserId ?: return
        val db = backendClient?.getFirebaseFirestore()?.getOrNull() ?: return
        val memId = "mem-" + UUID.randomUUID().toString().take(8)
        val nowIso = Instant.now().toString()
        runCatching {
            db.collection("users")
                .document(uid)
                .collection("memories")
                .document(memId)
                .set(
                    mapOf(
                        "userId" to uid,
                        "key" to (key ?: "preference"),
                        "content" to content,
                        "value" to content,
                        "category" to category.uppercase(),
                        "importance" to "medium",
                        "createdAt" to nowIso,
                        "updatedAt" to nowIso
                    )
                )
                .await()
        }
    }
}

class JessRepositoryImpl(
    private val conversationRepository: ConversationRepository,
    private val deviceControlRepository: DeviceControlRepository,
    private val deviceRegistryRepository: DeviceRegistryRepository,
    private val backendClient: HubMindBackendClient? = null,
    private val authRepository: AuthRepository? = null,
    private val context: Context? = null
) : JessRepository {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _liveState = MutableStateFlow(JessLiveState.IDLE)
    override val liveState: StateFlow<JessLiveState> = _liveState.asStateFlow()

    private val _connectionState = MutableStateFlow(
        if (backendClient == null) LiveConnectionState.CONNECTED else LiveConnectionState.DISCONNECTED
    )
    override val connectionState: StateFlow<LiveConnectionState> = _connectionState.asStateFlow()

    private val _activeLeaseClient = MutableStateFlow<String?>(null)
    override val activeLeaseClient: StateFlow<String?> = _activeLeaseClient.asStateFlow()

    @Volatile
    var lastExecutedToolName: String? = null
        private set

    @Volatile
    var lastExecutionStatus: String? = null
        private set

    private var liveSession: GeminiLiveAudioSession? = null
    private var leaseListener: ListenerRegistration? = null
    private val currentTurnUserBuffer = StringBuilder()
    private val currentTurnJessBuffer = StringBuilder()

    fun observeSessionLease(userId: String) {
        val client = backendClient ?: return
        scope.launch {
            val db = client.getFirebaseFirestore().getOrNull() ?: return@launch
            leaseListener?.remove()
            leaseListener = db.collection("users")
                .document(userId)
                .collection("private")
                .document("jessActiveSession")
                .addSnapshotListener { snap, _ ->
                    if (snap != null && snap.exists()) {
                        val active = snap.getBoolean("active") ?: false
                        val owner = snap.getString("client")
                        _activeLeaseClient.value = if (active) owner else null
                    }
                }
        }
    }

    override suspend fun startVoiceSession(): Boolean {
        // Unit-test path when no backendClient is wired
        val client = backendClient
        if (client == null) {
            _connectionState.value = LiveConnectionState.CONNECTING
            _activeLeaseClient.value = "android"
            _connectionState.value = LiveConnectionState.CONNECTED
            _liveState.value = JessLiveState.LISTENING
            return true
        }

        _connectionState.value = LiveConnectionState.CONNECTING
        _liveState.value = JessLiveState.THINKING

        val tokenRes = client.getFreshIdToken(forceRefresh = false)
        val idToken = tokenRes.getOrElse {
            _connectionState.value = LiveConnectionState.ERROR
            _liveState.value = JessLiveState.ERROR
            return false
        }

        val liveTokenRes = client.mintLiveEphemeralToken(idToken)
        val ephemeral = liveTokenRes.getOrElse {
            _connectionState.value = LiveConnectionState.ERROR
            _liveState.value = JessLiveState.ERROR
            return false
        }

        // Claim the cross-device voice session lease in Firestore
        val uid = authRepository?.currentUser?.value?.id ?: ephemeral.userId
        if (uid.isNotBlank()) {
            runCatching {
                val db = client.getFirebaseFirestore().getOrNull()
                db?.collection("users")
                    ?.document(uid)
                    ?.collection("private")
                    ?.document("jessActiveSession")
                    ?.set(
                        mapOf(
                            "sessionId" to ("sess-android-" + UUID.randomUUID().toString().take(8)),
                            "client" to "android",
                            "active" to true,
                            "updatedAt" to System.currentTimeMillis()
                        ),
                        SetOptions.merge()
                    )
                    ?.await()
                _activeLeaseClient.value = "android"
            }
        }

        val memories = (conversationRepository as? ConversationRepositoryImpl)?.userMemories?.value ?: emptyList()
        val systemInstruction = JessCanonicalConfig.buildSystemInstruction(
            user = authRepository?.currentUser?.value,
            memories = memories,
            devices = deviceRegistryRepository.devices.value,
            targetDevice = deviceRegistryRepository.currentTargetDevice.value
        )
        val toolDecls = JessCanonicalConfig.buildToolDeclarations()

        liveSession?.shutdown()
        val session = GeminiLiveAudioSession(
            context = context,
            httpClient = client.httpClient,
            callbacks = object : GeminiLiveCallbacks {
                override fun onConnectionStateChanged(state: LiveConnectionState) {
                    _connectionState.value = state
                }

                override fun onJessStateChanged(state: JessLiveState) {
                    _liveState.value = state
                }

                override fun onUserTranscript(text: String) {
                    synchronized(currentTurnUserBuffer) {
                        currentTurnUserBuffer.append(text)
                    }
                }

                override fun onJessTranscript(text: String) {
                    synchronized(currentTurnJessBuffer) {
                        currentTurnJessBuffer.append(text)
                    }
                }

                override fun onTurnComplete() {
                    val userText: String
                    val jessText: String
                    synchronized(currentTurnUserBuffer) {
                        userText = currentTurnUserBuffer.toString().trim()
                        currentTurnUserBuffer.clear()
                    }
                    synchronized(currentTurnJessBuffer) {
                        jessText = currentTurnJessBuffer.toString().trim()
                        currentTurnJessBuffer.clear()
                    }
                    if (userText.isNotBlank() || jessText.isNotBlank()) {
                        scope.launch {
                            val conv = conversationRepository.currentConversation.value
                                ?: conversationRepository.createConversation("Live Voice with Jess")
                            if (userText.isNotBlank()) {
                                conversationRepository.postUserMessage(
                                    conv.id,
                                    userText,
                                    deviceRegistryRepository.currentTargetDevice.value?.deviceId
                                )
                            }
                            if (jessText.isNotBlank()) {
                                conversationRepository.appendJessResponse(
                                    conv.id,
                                    jessText,
                                    lastExecutedToolName,
                                    lastExecutionStatus
                                )
                            }
                        }
                    }
                }

                override fun onToolCall(call: JessFunctionCall, respond: (Map<String, Any?>) -> Unit) {
                    scope.launch {
                        val toolRes = executeJessFunctionCall(call)
                        respond(toolRes)
                    }
                }

                override fun onError(message: String) {
                    _liveState.value = JessLiveState.ERROR
                }
            }
        )
        liveSession = session
        session.connect(ephemeral.token, systemInstruction, toolDecls)
        return true
    }

    override suspend fun endVoiceSession() {
        liveSession?.shutdown()
        liveSession = null
        _liveState.value = JessLiveState.IDLE
        _connectionState.value = LiveConnectionState.DISCONNECTED

        val client = backendClient
        val uid = authRepository?.currentUser?.value?.id
        if (client != null && !uid.isNullOrBlank()) {
            runCatching {
                val db = client.getFirebaseFirestore().getOrNull()
                db?.collection("users")
                    ?.document(uid)
                    ?.collection("private")
                    ?.document("jessActiveSession")
                    ?.set(
                        mapOf(
                            "client" to "android",
                            "active" to false,
                            "updatedAt" to System.currentTimeMillis()
                        ),
                        SetOptions.merge()
                    )
                    ?.await()
            }
        }
    }

    override suspend fun setLiveState(state: JessLiveState) {
        _liveState.value = state
    }

    private suspend fun executeJessFunctionCall(call: JessFunctionCall): Map<String, Any?> {
        return when (call.name) {
            "android_device_action" -> {
                val localAndroidId = deviceRegistryRepository.devices.value
                    .firstOrNull { it.isCurrentDevice || it.platform == DevicePlatform.ANDROID }
                    ?.deviceId ?: "android-local"
                val actionType = (call.args["actionType"] as? String) ?: "GET_SCREEN_HIERARCHY"
                val res = deviceControlRepository.executeTool(localAndroidId, actionType, call.args)
                lastExecutedToolName = actionType
                lastExecutionStatus = if (res.success && res.verified) "done_verified" else if (res.success) "sent_unverified" else "failed"
                mapOf(
                    "success" to res.success,
                    "verified" to res.verified,
                    "status" to lastExecutionStatus,
                    "output" to (res.output ?: ""),
                    "error" to res.error
                )
            }
            "windows_device_action" -> {
                val targetWinId = (call.args["targetDeviceId"] as? String)?.takeIf { it.isNotBlank() }
                    ?: deviceRegistryRepository.devices.value.firstOrNull { it.platform == DevicePlatform.WINDOWS }?.deviceId
                    ?: deviceRegistryRepository.currentTargetDevice.value?.deviceId
                    ?: "windows-workstation"
                val toolName = (call.args["toolName"] as? String) ?: "get_windows_system_info"
                val res = deviceControlRepository.executeTool(targetWinId, toolName, call.args)
                lastExecutedToolName = toolName
                lastExecutionStatus = if (res.success && res.verified) "done_verified" else if (res.success) "sent_unverified" else "failed"
                mapOf(
                    "success" to res.success,
                    "verified" to res.verified,
                    "status" to lastExecutionStatus,
                    "output" to (res.output ?: ""),
                    "error" to res.error
                )
            }
            "save_user_memory" -> {
                val content = (call.args["content"] as? String).orEmpty()
                val key = call.args["key"] as? String
                val category = (call.args["category"] as? String) ?: "FACT"
                if (content.isNotBlank()) {
                    (conversationRepository as? ConversationRepositoryImpl)?.saveMemory(key, content, category)
                }
                lastExecutedToolName = "save_user_memory"
                lastExecutionStatus = "done_verified"
                mapOf("success" to true, "verified" to true, "status" to "done_verified")
            }
            "end_session" -> {
                endVoiceSession()
                lastExecutedToolName = "end_session"
                lastExecutionStatus = "done_verified"
                mapOf("success" to true, "verified" to true, "status" to "done_verified")
            }
            else -> {
                val targetId = deviceRegistryRepository.currentTargetDevice.value?.deviceId ?: "android-local"
                val res = deviceControlRepository.executeTool(targetId, call.name, call.args)
                lastExecutedToolName = call.name
                lastExecutionStatus = if (res.success && res.verified) "done_verified" else if (res.success) "sent_unverified" else "failed"
                mapOf(
                    "success" to res.success,
                    "verified" to res.verified,
                    "status" to lastExecutionStatus,
                    "output" to (res.output ?: ""),
                    "error" to res.error
                )
            }
        }
    }

    override suspend fun sendPrompt(prompt: String, targetDeviceId: String?): Flow<String> = flow {
        _liveState.value = JessLiveState.THINKING
        lastExecutedToolName = null
        lastExecutionStatus = null

        val client = backendClient
        if (client == null) {
            // Deterministic unit-test path when no backendClient is attached
            val target = targetDeviceId ?: deviceRegistryRepository.currentTargetDevice.value?.deviceId ?: "android-local"
            val res = deviceControlRepository.executeTool(target, "prompt_dispatch", mapOf("prompt" to prompt))
            lastExecutedToolName = "prompt_dispatch"
            lastExecutionStatus = if (res.success && res.verified) "done_verified" else "failed"
            _liveState.value = JessLiveState.SPEAKING
            emit(res.output ?: "Completed prompt execution.")
            _liveState.value = JessLiveState.IDLE
            return@flow
        }

        val tokenRes = client.getFreshIdToken(forceRefresh = false)
        val idToken = tokenRes.getOrElse { err ->
            _liveState.value = JessLiveState.ERROR
            lastExecutionStatus = "failed"
            emit("Authentication required: ${err.message}")
            return@flow
        }

        val conv = conversationRepository.currentConversation.value
        val historyMessages = if (conv != null) {
            conversationRepository.getMessages(conv.id).first().takeLast(16)
        } else {
            emptyList()
        }

        val messagesJson = JSONArray()
        for (m in historyMessages) {
            messagesJson.put(JSONObject().apply {
                put("role", if (m.sender == MessageSender.JESS) "model" else "user")
                put("content", m.text)
            })
        }
        if (historyMessages.none { it.text == prompt && it.sender == MessageSender.USER }) {
            messagesJson.put(JSONObject().apply {
                put("role", "user")
                put("content", prompt)
            })
        }

        val memories = (conversationRepository as? ConversationRepositoryImpl)?.userMemories?.value ?: emptyList()
        val selectedTarget = targetDeviceId?.let { id ->
            deviceRegistryRepository.devices.value.find { it.deviceId == id }
        } ?: deviceRegistryRepository.currentTargetDevice.value

        val systemInstruction = JessCanonicalConfig.buildSystemInstruction(
            user = authRepository?.currentUser?.value,
            memories = memories,
            devices = deviceRegistryRepository.devices.value,
            targetDevice = selectedTarget
        )
        val toolDecls = JessCanonicalConfig.buildToolDeclarations()

        val turnRes = client.sendChatTurn(
            idToken = idToken,
            messages = messagesJson,
            systemInstruction = systemInstruction,
            toolsDeclarations = toolDecls
        )

        val turn = turnRes.getOrElse { err ->
            _liveState.value = JessLiveState.ERROR
            lastExecutionStatus = "failed"
            emit("Could not reach Jess on Hub-Mind server: ${err.message}")
            return@flow
        }

        val toolSummaries = mutableListOf<String>()
        for (fc in turn.functionCalls) {
            val execMap = executeJessFunctionCall(fc)
            val ok = execMap["success"] == true
            val verified = execMap["verified"] == true
            val out = execMap["output"]?.toString().orEmpty()
            val err = execMap["error"]?.toString().orEmpty()
            if (ok) {
                toolSummaries.add(
                    if (verified) "Verified ${lastExecutedToolName ?: fc.name}: $out"
                    else "Dispatched ${lastExecutedToolName ?: fc.name} (unverified): $out"
                )
            } else {
                toolSummaries.add("Action ${lastExecutedToolName ?: fc.name} failed: $err")
            }
        }

        _liveState.value = JessLiveState.SPEAKING
        val finalReply = buildString {
            if (turn.text.isNotBlank()) {
                append(turn.text.trim())
            }
            if (toolSummaries.isNotEmpty()) {
                if (isNotEmpty()) append("\n\n")
                append(toolSummaries.joinToString("\n"))
            }
        }.ifBlank {
            "Done."
        }

        emit(finalReply)
        _liveState.value = JessLiveState.IDLE
    }
}

class DeviceRegistryRepositoryImpl(
    private val context: Context?,
    private val backendClient: HubMindBackendClient? = null,
    private val controlPlaneTransport: HubMindControlPlaneTransport? = null
) : DeviceRegistryRepository {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var devicesListener: ListenerRegistration? = null
    private var heartbeatJob: Job? = null
    private var boundUserId: String? = null

    val localDeviceId: String by lazy {
        val androidId = runCatching {
            context?.contentResolver?.let { Settings.Secure.getString(it, Settings.Secure.ANDROID_ID) }
        }.getOrNull()?.takeIf { it.isNotBlank() }?.take(10) ?: "phone"
        "android-$androidId"
    }

    private fun buildCurrentAndroidNode(): DeviceNode {
        val manufacturer = Build.MANUFACTURER?.takeIf { it.isNotBlank() }?.replaceFirstChar { it.uppercase() } ?: "Android"
        val model = Build.MODEL?.takeIf { it.isNotBlank() } ?: "Phone"
        val name = if (model.startsWith(manufacturer, ignoreCase = true)) model else "$manufacturer $model"
        val bm = context?.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        val bat = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.takeIf { it in 0..100 }
        val accConnected = HubMindAccessibilityService.isServiceConnected
        val caps = buildList {
            add(DeviceCapability.APP_LAUNCH)
            if (accConnected) {
                add(DeviceCapability.ANDROID_ACCESSIBILITY)
                add(DeviceCapability.SCREEN_READING)
                add(DeviceCapability.MOUSE_KEYBOARD_INPUT)
            }
        }
        return DeviceNode(
            deviceId = localDeviceId,
            deviceName = name,
            platform = DevicePlatform.ANDROID,
            clientVersion = context?.let { appContext ->
                runCatching {
                    appContext.packageManager.getPackageInfo(appContext.packageName, 0).versionName
                }.getOrNull()
            } ?: "2.4.0",
            status = DeviceStatus.ONLINE,
            isCurrentDevice = true,
            fullControlActive = accConnected,
            permissionMode = "allow-routine",
            capabilities = caps,
            lastSeenAt = System.currentTimeMillis(),
            batteryPercent = bat,
            ipAddress = detectLocalIpv4()
        )
    }

    private fun detectLocalIpv4(): String? {
        return runCatching {
            val interfaces = NetworkInterface.getNetworkInterfaces() ?: return@runCatching null
            for (intf in interfaces) {
                if (!intf.isUp || intf.isLoopback) continue
                for (addr in intf.inetAddresses) {
                    if (!addr.isLoopbackAddress && addr is Inet4Address) {
                        return@runCatching addr.hostAddress
                    }
                }
            }
            null
        }.getOrNull()
    }

    private val _devices = MutableStateFlow<List<DeviceNode>>(listOf(buildCurrentAndroidNode()))
    override val devices: StateFlow<List<DeviceNode>> = _devices.asStateFlow()

    private val _currentTargetDevice = MutableStateFlow<DeviceNode?>(_devices.value.firstOrNull())
    override val currentTargetDevice: StateFlow<DeviceNode?> = _currentTargetDevice.asStateFlow()

    fun bindToUser(userId: String) {
        if (boundUserId == userId && devicesListener != null) return
        boundUserId = userId
        val client = backendClient ?: return

        scope.launch {
            controlPlaneTransport?.connect(userId, localDeviceId)
            registerCurrentDevice(buildCurrentAndroidNode())

            val db = client.getFirebaseFirestore().getOrNull() ?: return@launch
            devicesListener?.remove()
            devicesListener = db.collection("users")
                .document(userId)
                .collection("devices")
                .addSnapshotListener { snap, err ->
                    if (err != null || snap == null) return@addSnapshotListener
                    val now = System.currentTimeMillis()
                    val remoteNodes = snap.documents.mapNotNull { doc ->
                        val devId = doc.getString("deviceId") ?: doc.id
                        val platformStr = (doc.getString("platform") ?: "ANDROID").uppercase()
                        val platform = runCatching { DevicePlatform.valueOf(platformStr) }
                            .getOrDefault(DevicePlatform.ANDROID)
                        val lastSeen = doc.getLong("lastSeen") ?: doc.getLong("lastSeenAt") ?: 0L
                        val rawStatus = (doc.getString("status") ?: "ONLINE").uppercase()
                        val isFresh = (now - lastSeen) < 65_000L
                        val status = if (devId == localDeviceId) {
                            DeviceStatus.ONLINE
                        } else if (!isFresh || rawStatus == "OFFLINE") {
                            DeviceStatus.OFFLINE
                        } else {
                            runCatching { DeviceStatus.valueOf(rawStatus) }.getOrDefault(DeviceStatus.ONLINE)
                        }
                        @Suppress("UNCHECKED_CAST")
                        val capNames = (doc.get("capabilities") as? List<String>).orEmpty()
                        val caps = capNames.mapNotNull { c ->
                            runCatching { DeviceCapability.valueOf(c) }.getOrNull()
                        }
                        DeviceNode(
                            deviceId = devId,
                            deviceName = doc.getString("deviceName") ?: devId,
                            platform = platform,
                            clientVersion = doc.getString("clientVersion") ?: "2.4.0",
                            status = status,
                            isCurrentDevice = devId == localDeviceId,
                            fullControlActive = doc.getBoolean("fullControlActive") ?: false,
                            permissionMode = doc.getString("permissionMode") ?: "allow-routine",
                            capabilities = caps,
                            lastSeenAt = if (lastSeen > 0) lastSeen else now,
                            batteryPercent = doc.getLong("batteryPercent")?.toInt(),
                            ipAddress = doc.getString("ipAddress")
                        )
                    }

                    val merged = if (remoteNodes.any { it.deviceId == localDeviceId }) {
                        remoteNodes
                    } else {
                        listOf(buildCurrentAndroidNode()) + remoteNodes
                    }
                    _devices.value = merged

                    val currentSelected = _currentTargetDevice.value
                    val updatedSelection = merged.find { it.deviceId == currentSelected?.deviceId }
                        ?: merged.firstOrNull { it.platform == DevicePlatform.WINDOWS && it.status == DeviceStatus.ONLINE }
                        ?: merged.firstOrNull()
                    _currentTargetDevice.value = updatedSelection
                }

            heartbeatJob?.cancel()
            heartbeatJob = scope.launch {
                while (isActive) {
                    delay(15_000L)
                    registerCurrentDevice(buildCurrentAndroidNode())
                }
            }
        }
    }

    override suspend fun selectTargetDevice(deviceId: String) {
        _currentTargetDevice.value = _devices.value.find { it.deviceId == deviceId }
    }

    override suspend fun registerCurrentDevice(androidNode: DeviceNode) {
        val updatedList = _devices.value.filter { it.deviceId != androidNode.deviceId } + androidNode
        _devices.value = updatedList

        val uid = boundUserId ?: return
        val client = backendClient ?: return
        KeystorePairingManager.generateDeviceKeyPair()
        val keyFp = KeystorePairingManager.getPublicKeyFingerprint()

        val now = System.currentTimeMillis()
        val docMap = mutableMapOf<String, Any>(
            "deviceId" to androidNode.deviceId,
            "userId" to uid,
            "deviceName" to androidNode.deviceName,
            "platform" to androidNode.platform.name,
            "clientVersion" to androidNode.clientVersion,
            "status" to androidNode.status.name,
            "fullControlActive" to androidNode.fullControlActive,
            "permissionMode" to androidNode.permissionMode,
            "capabilities" to androidNode.capabilities.map { it.name },
            "lastSeen" to now,
            "lastSeenAt" to now,
            "batteryPercent" to (androidNode.batteryPercent ?: -1)
        )
        androidNode.ipAddress?.takeIf { it.isNotBlank() }?.let { docMap["ipAddress"] = it }
        keyFp?.takeIf { it.isNotBlank() }?.let { docMap["publicKeyFingerprint"] = it }

        val db = client.getFirebaseFirestore().getOrNull()
        if (db != null) {
            runCatching {
                db.collection("users")
                    .document(uid)
                    .collection("devices")
                    .document(androidNode.deviceId)
                    .set(docMap, SetOptions.merge())
                    .await()
            }
        } else {
            val token = client.getFreshIdToken().getOrNull()
            if (token != null) {
                client.registerDeviceOnBackend(token, JSONObject(docMap))
            }
        }
    }

    override suspend fun pingDevice(deviceId: String): Boolean {
        if (deviceId == localDeviceId) return true
        val transport = controlPlaneTransport ?: return false
        val uid = boundUserId ?: return false
        val envelope = CommandEnvelope(
            issuingUserId = uid,
            sourceDeviceId = localDeviceId,
            targetDeviceId = deviceId,
            actionType = "ping_device",
            expirationTime = System.currentTimeMillis() + 8_000L
        )
        val res = transport.dispatchCommand(envelope)
        return res.success
    }

    override suspend fun refreshDevices() {
        registerCurrentDevice(buildCurrentAndroidNode())
    }
}

class DeviceControlRepositoryImpl(
    private val transports: List<ControlTransport>,
    private val localExecutor: AndroidUiActionExecutor? = null,
    private val controlPlaneTransport: HubMindControlPlaneTransport? = null,
    private val authRepository: AuthRepository? = null,
    private val localDeviceIdProvider: () -> String = { "android-local" }
) : DeviceControlRepository {

    private val _commandHistory = MutableStateFlow<List<DeviceCommand>>(emptyList())
    override val commandHistory: StateFlow<List<DeviceCommand>> = _commandHistory.asStateFlow()

    private val _activityRecords = MutableStateFlow<List<ActivityRecord>>(emptyList())
    override val activityRecords: StateFlow<List<ActivityRecord>> = _activityRecords.asStateFlow()

    override suspend fun executeTool(
        targetDeviceId: String,
        toolName: String,
        args: Map<String, Any>
    ): CommandResult {
        val startMs = System.currentTimeMillis()
        val localId = localDeviceIdProvider()
        val cmdId = "cmd-" + UUID.randomUUID().toString().take(8)

        val command = DeviceCommand(
            commandId = cmdId,
            sourceDeviceId = localId,
            targetDeviceId = targetDeviceId,
            toolName = toolName,
            arguments = args,
            status = CommandStatus.RUNNING,
            createdAt = startMs
        )
        _commandHistory.value = listOf(command) + _commandHistory.value

        val isLocalTarget = targetDeviceId == localId

        val result: CommandResult = when {
            isLocalTarget -> {
                val executor = localExecutor
                    ?: return CommandResult(false, false, error = "Android native executor is not initialized.")
                val actionStr = (args["actionType"] as? String)?.ifBlank { null } ?: toolName
                val actionType = runCatching { AndroidActionType.valueOf(actionStr.uppercase()) }
                    .getOrElse {
                        when (actionStr.uppercase()) {
                            "LAUNCH_APP", "OPEN_APP" -> AndroidActionType.OPEN_APP
                            "NAVIGATE_BACK", "BACK" -> AndroidActionType.NAVIGATE_BACK
                            "GO_HOME", "HOME" -> AndroidActionType.GO_HOME
                            "CAPTURE_SCREEN", "SCREENSHOT" -> AndroidActionType.CAPTURE_SCREEN
                            else -> null
                        }
                    } ?: return CommandResult(
                        false, false,
                        error = "Unsupported Android action '$actionStr'. No fallback action was run."
                    )
                val androidRes = executor.executeCommand(
                    AndroidCommand(
                        commandId = cmdId,
                        actionType = actionType,
                        parameters = args,
                        requiresConfirmation = args["requiresConfirmation"] == true
                    )
                )
                CommandResult(
                    success = androidRes.success,
                    verified = androidRes.verified,
                    output = androidRes.outputText,
                    error = androidRes.error,
                    durationMs = androidRes.durationMs
                )
            }
            else -> {
                val uid = authRepository?.currentUser?.value?.id
                    ?: return CommandResult(false, false, error = "Sign in before controlling a paired device.")
                val transport = controlPlaneTransport
                    ?: return CommandResult(false, false, error = "Cross-device control is not available on this build.")
                val envelope = CommandEnvelope(
                    commandId = cmdId,
                    issuingUserId = uid,
                    sourceDeviceId = localId,
                    targetDeviceId = targetDeviceId,
                    actionType = toolName,
                    parameters = args,
                    creationTime = startMs,
                    expirationTime = startMs + 20_000L,
                    requiresConfirmation = args["requiresConfirmation"] == true
                )
                transport.dispatchCommand(envelope)
            }
        }

        val finalStatus = if (result.success) CommandStatus.COMPLETED else CommandStatus.FAILED
        val completedCmd = command.copy(
            status = finalStatus,
            completedAt = System.currentTimeMillis(),
            result = result
        )
        _commandHistory.value = _commandHistory.value.map { if (it.commandId == cmdId) completedCmd else it }

        val activity = ActivityRecord(
            id = "act-" + UUID.randomUUID().toString().take(8),
            title = toolName,
            details = result.output ?: result.error ?: "Dispatched to $targetDeviceId",
            targetDevice = targetDeviceId,
            status = finalStatus,
            timestamp = System.currentTimeMillis(),
            durationMs = result.durationMs,
            verified = result.verified
        )
        _activityRecords.value = listOf(activity) + _activityRecords.value

        return result
    }

    override suspend fun cancelCommand(commandId: String): Boolean {
        _commandHistory.value = _commandHistory.value.map {
            if (it.commandId == commandId) it.copy(status = CommandStatus.CANCELLED) else it
        }
        return true
    }
}

class AndroidAgentControllerImpl(private val context: Context) : AndroidAgentController {
    private val appLauncher = AndroidAppLauncher(context)

    override fun getBatteryLevel(): Int {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        return bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: 0
    }

    override fun isCharging(): Boolean {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        val status = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_STATUS)
        return status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
    }

    override fun getInstalledAppPackages(): List<String> {
        return appLauncher.getInstalledApplications().map { it.packageName }
    }

    override fun launchApplication(packageName: String): Boolean {
        return appLauncher.launchAppByPackage(packageName)
    }

    override fun getSystemAudioVolume(): Int {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        val max = (am?.getStreamMaxVolume(AudioManager.STREAM_MUSIC) ?: 15).coerceAtLeast(1)
        val current = am?.getStreamVolume(AudioManager.STREAM_MUSIC) ?: 10
        return (current * 100) / max
    }

    override fun setSystemAudioVolume(levelPercent: Int) {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val target = ((levelPercent.coerceIn(0, 100) * max) / 100)
        am.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0)
    }

    override fun copyToClipboard(label: String, text: String) {
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        val clip = ClipData.newPlainText(label, text)
        cm?.setPrimaryClip(clip)
    }

    override fun readFromClipboard(): String? {
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        return cm?.primaryClip?.getItemAt(0)?.text?.toString()
    }
}

class PermissionStatusRepositoryImpl(
    private val context: Context? = null
) : PermissionStatusRepository {

    private fun checkAudioPerm(): Boolean {
        val ctx = context ?: return true
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun checkNotificationPerm(): Boolean {
        val ctx = context ?: return true
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    private fun checkOverlayPerm(): Boolean {
        val ctx = context ?: return false
        return Settings.canDrawOverlays(ctx)
    }

    private val _hasRecordAudio = MutableStateFlow(checkAudioPerm())
    override val hasRecordAudio: StateFlow<Boolean> = _hasRecordAudio.asStateFlow()

    private val _hasPostNotifications = MutableStateFlow(checkNotificationPerm())
    override val hasPostNotifications: StateFlow<Boolean> = _hasPostNotifications.asStateFlow()

    private val _hasSystemAlertWindow = MutableStateFlow(checkOverlayPerm())
    override val hasSystemAlertWindow: StateFlow<Boolean> = _hasSystemAlertWindow.asStateFlow()

    private val _hasAccessibilityService = MutableStateFlow(HubMindAccessibilityService.isServiceConnected)
    override val hasAccessibilityService: StateFlow<Boolean> = _hasAccessibilityService.asStateFlow()

    fun refreshFromSystem() {
        _hasRecordAudio.value = checkAudioPerm()
        _hasPostNotifications.value = checkNotificationPerm()
        _hasSystemAlertWindow.value = checkOverlayPerm()
        _hasAccessibilityService.value = HubMindAccessibilityService.isServiceConnected
    }

    override fun updatePermissions(
        audio: Boolean,
        notifications: Boolean,
        overlay: Boolean,
        accessibility: Boolean
    ) {
        _hasRecordAudio.value = audio
        _hasPostNotifications.value = notifications
        _hasSystemAlertWindow.value = overlay
        _hasAccessibilityService.value = accessibility
    }
}

class VoiceInteractionRepositoryImpl : VoiceInteractionRepository {
    private val _isMicMuted = MutableStateFlow(false)
    override val isMicMuted: StateFlow<Boolean> = _isMicMuted.asStateFlow()

    private val _audioInputLevel = MutableStateFlow(0f)
    override val audioInputLevel: StateFlow<Float> = _audioInputLevel.asStateFlow()

    private val _audioOutputLevel = MutableStateFlow(0f)
    override val audioOutputLevel: StateFlow<Float> = _audioOutputLevel.asStateFlow()

    override suspend fun setMicMuted(muted: Boolean) {
        _isMicMuted.value = muted
    }

    override suspend fun updateLevels(input: Float, output: Float) {
        _audioInputLevel.value = input
        _audioOutputLevel.value = output
    }
}
