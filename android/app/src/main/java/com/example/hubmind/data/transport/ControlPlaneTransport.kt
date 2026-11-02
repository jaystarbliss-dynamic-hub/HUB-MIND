package com.example.hubmind.data.transport

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.example.hubmind.agent.AndroidActionType
import com.example.hubmind.agent.AndroidCommand
import com.example.hubmind.agent.AndroidUiActionExecutor
import com.example.hubmind.data.model.CommandResult
import com.example.hubmind.data.model.DeviceNode
import com.example.hubmind.data.remote.HubMindBackendClient
import com.google.firebase.firestore.ListenerRegistration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.KeyStore
import java.util.Collections
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume

enum class CommandLifecycle {
    CREATED,
    DISPATCHED,
    ACCEPTED,
    EXECUTING,
    COMPLETED,
    FAILED,
    CANCELLED,
    TIMED_OUT
}

data class CommandEnvelope(
    val protocolVersion: String = "1.0",
    val commandId: String = "cmd-" + UUID.randomUUID().toString(),
    val taskId: String? = null,
    val conversationId: String? = null,
    val issuingUserId: String,
    val sourceDeviceId: String,
    val targetDeviceId: String,
    val actionType: String,
    val parameters: Map<String, Any> = emptyMap(),
    val creationTime: Long = System.currentTimeMillis(),
    val expirationTime: Long = System.currentTimeMillis() + 30000,
    val replayToken: String = "nonce-" + UUID.randomUUID().toString().take(12),
    val requiresConfirmation: Boolean = false,
    val correlationId: String = "corr-" + UUID.randomUUID().toString().take(8),
    val lifecycleState: CommandLifecycle = CommandLifecycle.CREATED
)

object KeystorePairingManager {
    private const val KEY_ALIAS = "HubMindDevicePairingKey"

    fun generateDeviceKeyPair(): Boolean {
        return try {
            val keyStore = KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)
            if (!keyStore.containsAlias(KEY_ALIAS)) {
                val kpg = KeyPairGenerator.getInstance(
                    KeyProperties.KEY_ALGORITHM_EC,
                    "AndroidKeyStore"
                )
                val spec = KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
                ).setDigests(KeyProperties.DIGEST_SHA256)
                    .build()
                kpg.initialize(spec)
                kpg.generateKeyPair()
            }
            true
        } catch (e: Exception) {
            false
        }
    }

    fun getPublicKeyFingerprint(): String? {
        return runCatching {
            val keyStore = KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)
            val cert = keyStore.getCertificate(KEY_ALIAS)
                ?: throw IllegalStateException("Android Keystore pairing certificate is unavailable.")
            MessageDigest.getInstance("SHA-256")
                .digest(cert.publicKey.encoded)
                .joinToString("") { "%02x".format(it) }
        }.getOrNull()
    }
}

interface HubMindControlPlaneTransport {
    val isConnected: StateFlow<Boolean>
    val incomingCommands: Flow<CommandEnvelope>
    suspend fun connect(userId: String, deviceId: String)
    suspend fun disconnect()
    suspend fun dispatchCommand(envelope: CommandEnvelope): CommandResult
    suspend fun reportProgress(commandId: String, state: CommandLifecycle, details: String)
}

class HubMindControlPlaneTransportImpl(
    private val backendClient: HubMindBackendClient? = null,
    private val localExecutor: AndroidUiActionExecutor? = null
) : HubMindControlPlaneTransport {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _isConnected = MutableStateFlow(backendClient == null)
    override val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()

    private val _incomingCommands = MutableSharedFlow<CommandEnvelope>(
        replay = 1,
        extraBufferCapacity = 16,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    override val incomingCommands: Flow<CommandEnvelope> = _incomingCommands.asSharedFlow()

    private var activeUserId: String? = null
    private var activeDeviceId: String? = null
    private var incomingListener: ListenerRegistration? = null
    private val processedReplayTokens: MutableSet<String> =
        Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())
    private val processedCommandIds: MutableSet<String> =
        Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())

    override suspend fun connect(userId: String, deviceId: String) {
        activeUserId = userId
        activeDeviceId = deviceId
        KeystorePairingManager.generateDeviceKeyPair()

        if (backendClient == null) {
            _isConnected.value = true
            return
        }

        val dbRes = backendClient.getFirebaseFirestore()
        val db = dbRes.getOrNull()
        if (db == null) {
            _isConnected.value = false
            return
        }

        incomingListener?.remove()
        incomingListener = db.collection("users")
            .document(userId)
            .collection("deviceCommands")
            .whereEqualTo("targetDeviceId", deviceId)
            .whereEqualTo("lifecycleState", "DISPATCHED")
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    _isConnected.value = false
                    return@addSnapshotListener
                }
                _isConnected.value = true
                val docs = snapshot?.documents ?: return@addSnapshotListener
                for (doc in docs) {
                    val status = doc.getString("lifecycleState") ?: continue
                    if (status != "DISPATCHED") continue
                    val cmdId = doc.getString("commandId") ?: doc.id
                    if (!processedCommandIds.add(cmdId)) continue

                    val replayToken = doc.getString("replayToken") ?: ""
                    if (replayToken.isBlank() || !processedReplayTokens.add(replayToken)) {
                        scope.launch {
                            doc.reference.update(
                                mapOf(
                                    "lifecycleState" to "FAILED",
                                    "resultSuccess" to false,
                                    "resultVerified" to false,
                                    "resultError" to "Replay token rejected.",
                                    "completedAt" to System.currentTimeMillis()
                                )
                            )
                        }
                        continue
                    }

                    val expiresAt = doc.getLong("expirationTime") ?: 0L
                    if (expiresAt <= System.currentTimeMillis()) {
                        scope.launch {
                            doc.reference.update(
                                mapOf(
                                    "lifecycleState" to "TIMED_OUT",
                                    "resultSuccess" to false,
                                    "resultVerified" to false,
                                    "resultError" to "Command expired before execution.",
                                    "completedAt" to System.currentTimeMillis()
                                )
                            )
                        }
                        continue
                    }

                    val issuingUserId = doc.getString("issuingUserId") ?: ""
                    if (issuingUserId != userId) {
                        scope.launch {
                            doc.reference.update(
                                mapOf(
                                    "lifecycleState" to "FAILED",
                                    "resultSuccess" to false,
                                    "resultVerified" to false,
                                    "resultError" to "Command issuer does not match the authenticated account.",
                                    "completedAt" to System.currentTimeMillis()
                                )
                            )
                        }
                        continue
                    }

                    val actionType = doc.getString("actionType") ?: ""
                    val rawParams = runCatching {
                        val json = JSONObject(doc.getString("parametersJson") ?: "{}")
                        val values = mutableMapOf<String, Any>()
                        val keys = json.keys()
                        while (keys.hasNext()) {
                            val key = keys.next()
                            val value = json.opt(key)
                            if (value != null && value != JSONObject.NULL) values[key] = value
                        }
                        values
                    }.getOrDefault(emptyMap())
                    val envelope = CommandEnvelope(
                        commandId = cmdId,
                        issuingUserId = issuingUserId,
                        sourceDeviceId = doc.getString("sourceDeviceId") ?: "remote",
                        targetDeviceId = deviceId,
                        actionType = actionType,
                        parameters = rawParams,
                        creationTime = doc.getLong("issuedAt") ?: System.currentTimeMillis(),
                        expirationTime = expiresAt,
                        replayToken = replayToken,
                        requiresConfirmation = doc.getBoolean("requiresConfirmation") ?: false,
                        correlationId = doc.getString("correlationId") ?: "corr-$cmdId",
                        lifecycleState = CommandLifecycle.ACCEPTED
                    )
                    _incomingCommands.tryEmit(envelope)
                    scope.launch {
                        executeIncomingCommand(userId, cmdId, envelope)
                    }
                }
            }
    }

    private suspend fun executeIncomingCommand(
        userId: String,
        commandId: String,
        envelope: CommandEnvelope
    ) {
        val db = backendClient?.getFirebaseFirestore()?.getOrNull() ?: return
        val cmdRef = db.collection("users").document(userId).collection("deviceCommands").document(commandId)
        val startMs = System.currentTimeMillis()

        runCatching {
            cmdRef.update(mapOf("lifecycleState" to "EXECUTING", "acknowledgedAt" to startMs)).await()
        }

        if (envelope.actionType.equals("ping_device", ignoreCase = true) ||
            envelope.actionType.equals("PING", ignoreCase = true)
        ) {
            val dur = System.currentTimeMillis() - startMs
            runCatching {
                cmdRef.update(
                    mapOf(
                        "lifecycleState" to "COMPLETED",
                        "resultSuccess" to true,
                        "resultVerified" to true,
                        "resultSummary" to "Android agent online and responsive.",
                        "durationMs" to dur,
                        "completedAt" to System.currentTimeMillis()
                    )
                ).await()
            }
            return
        }

        val executor = localExecutor
        if (executor == null) {
            runCatching {
                cmdRef.update(
                    mapOf(
                        "lifecycleState" to "FAILED",
                        "resultSuccess" to false,
                        "resultVerified" to false,
                        "resultError" to "AndroidUiActionExecutor is not initialized on this device.",
                        "completedAt" to System.currentTimeMillis()
                    )
                ).await()
            }
            return
        }

        val mappedAction = mapActionName(envelope.actionType, envelope.parameters)
        if (mappedAction == null) {
            cmdRef.update(
                mapOf(
                    "lifecycleState" to "FAILED",
                    "resultSuccess" to false,
                    "resultVerified" to false,
                    "resultError" to "Unsupported Android action. No fallback action was run.",
                    "completedAt" to System.currentTimeMillis()
                )
            )
            return
        }
        if (envelope.requiresConfirmation) {
            cmdRef.update(
                mapOf(
                    "lifecycleState" to "FAILED",
                    "resultSuccess" to false,
                    "resultVerified" to false,
                    "resultError" to "This action requires explicit confirmation on the target device. No confirmation was provided, so it was not executed.",
                    "completedAt" to System.currentTimeMillis()
                )
            )
            return
        }
        val androidCmd = AndroidCommand(
            commandId = commandId,
            actionType = mappedAction,
            parameters = envelope.parameters,
            expiryTimestamp = envelope.expirationTime,
            requiresConfirmation = envelope.requiresConfirmation
        )
        val actionResult = executor.executeCommand(androidCmd)
        val duration = System.currentTimeMillis() - startMs
        val statusStr = if (actionResult.success) "COMPLETED" else "FAILED"

        val updateMap = mutableMapOf<String, Any?>(
            "lifecycleState" to statusStr,
            "resultSuccess" to actionResult.success,
            "resultVerified" to actionResult.verified,
            "resultSummary" to (actionResult.outputText ?: ""),
            "resultError" to (actionResult.error ?: ""),
            "durationMs" to duration,
            "completedAt" to System.currentTimeMillis(),
            "result" to mapOf(
                "success" to actionResult.success,
                "verified" to actionResult.verified,
                "output" to (actionResult.outputText ?: ""),
                "error" to (actionResult.error ?: ""),
                "durationMs" to duration
            )
        )
        runCatching {
            cmdRef.update(updateMap).await()
        }.onFailure {
            val token = backendClient?.getFreshIdToken()?.getOrNull()
            if (token != null) {
                backendClient.updateDeviceCommandOnBackend(
                    token,
                    JSONObject().apply {
                        put("commandId", commandId)
                        put("deviceId", activeDeviceId.orEmpty())
                        put("lifecycleState", statusStr)
                        put("resultSuccess", actionResult.success)
                        put("resultVerified", actionResult.verified)
                        put("resultSummary", actionResult.outputText ?: "")
                        put("resultError", actionResult.error ?: "")
                        put("durationMs", duration)
                    }
                )
            }
        }
    }

    private fun mapActionName(rawAction: String, params: Map<String, Any>): AndroidActionType? {
        val candidate = (params["actionType"] as? String)?.ifBlank { null } ?: rawAction
        return when (candidate.uppercase().trim()) {
            "LAUNCH_APP", "OPEN_APP", "OPEN_APPLICATION" -> AndroidActionType.OPEN_APP
            "TAP", "CLICK" -> AndroidActionType.TAP
            "DOUBLE_TAP" -> AndroidActionType.DOUBLE_TAP
            "LONG_PRESS" -> AndroidActionType.LONG_PRESS
            "SWIPE" -> AndroidActionType.SWIPE
            "SCROLL" -> AndroidActionType.SCROLL
            "TYPE_TEXT", "INPUT_TEXT", "SEND_TEXT_TO_DEVICE" -> AndroidActionType.TYPE_TEXT
            "CLEAR_TEXT" -> AndroidActionType.CLEAR_TEXT
            "GET_INSTALLED_APPS" -> AndroidActionType.GET_INSTALLED_APPS
            "GET_SCREEN_HIERARCHY", "DUMP_HIERARCHY", "READ_SCREEN" -> AndroidActionType.GET_SCREEN_HIERARCHY
            "CAPTURE_SCREEN", "TAKE_SCREENSHOT", "GET_DEVICE_SCREEN" -> AndroidActionType.CAPTURE_SCREEN
            "SET_CLIPBOARD", "CLIPBOARD_WRITE" -> AndroidActionType.SET_CLIPBOARD
            "GET_CLIPBOARD", "CLIPBOARD_READ" -> AndroidActionType.GET_CLIPBOARD
            "NAVIGATE_BACK", "BACK" -> AndroidActionType.NAVIGATE_BACK
            "GO_HOME", "HOME" -> AndroidActionType.GO_HOME
            "OPEN_RECENTS", "RECENTS" -> AndroidActionType.OPEN_RECENTS
            "OPEN_NOTIFICATIONS", "NOTIFICATIONS" -> AndroidActionType.OPEN_NOTIFICATIONS
            "OPEN_QUICK_SETTINGS", "QUICK_SETTINGS" -> AndroidActionType.OPEN_QUICK_SETTINGS
            else -> null
        }
    }

    override suspend fun disconnect() {
        incomingListener?.remove()
        incomingListener = null
        _isConnected.value = false
    }

    override suspend fun dispatchCommand(envelope: CommandEnvelope): CommandResult {
        if (envelope.expirationTime < System.currentTimeMillis()) {
            return CommandResult(
                success = false,
                verified = false,
                error = "Command envelope expired before dispatch.",
                durationMs = 0
            )
        }

        if (!processedReplayTokens.add(envelope.replayToken)) {
            return CommandResult(
                success = false,
                verified = false,
                error = "Duplicate replayToken rejected by control plane.",
                durationMs = 0
            )
        }

        if (backendClient == null) {
            return CommandResult(
                success = false,
                verified = false,
                error = "Android control plane is not configured. No command was sent."
            )
        }

        val startMs = System.currentTimeMillis()
        val db = backendClient.getFirebaseFirestore().getOrNull()
        val auth = backendClient.getFirebaseAuth().getOrNull()
        val uid = auth?.currentUser?.uid
        if (uid.isNullOrBlank() || uid != envelope.issuingUserId) {
            return CommandResult(false, false, error = "The command issuer does not match the signed-in Hub-Mind account.")
        }

        if (db == null) {
            return CommandResult(
                success = false,
                verified = false,
                error = "Not authenticated with Hub-Mind Firestore control plane.",
                durationMs = System.currentTimeMillis() - startMs
            )
        }

        val devicesRef = db.collection("users").document(uid).collection("devices")
        val sourceDevice = runCatching { devicesRef.document(envelope.sourceDeviceId).get().await() }.getOrNull()
        val targetDevice = runCatching { devicesRef.document(envelope.targetDeviceId).get().await() }.getOrNull()
        if (sourceDevice?.exists() != true || targetDevice?.exists() != true) {
            return CommandResult(
                success = false,
                verified = false,
                error = "The source and target devices must both be registered to this Hub-Mind account.",
                durationMs = System.currentTimeMillis() - startMs
            )
        }

        val cmdRef = db.collection("users")
            .document(uid)
            .collection("deviceCommands")
            .document(envelope.commandId)

        val cmdDoc = mapOf(
            "commandId" to envelope.commandId,
            "protocolVersion" to envelope.protocolVersion,
            "issuingUserId" to uid,
            "sourceDeviceId" to envelope.sourceDeviceId,
            "targetDeviceId" to envelope.targetDeviceId,
            "actionType" to envelope.actionType,
            "parametersJson" to JSONObject(envelope.parameters).toString(),
            "lifecycleState" to "DISPATCHED",
            "replayToken" to envelope.replayToken,
            "correlationId" to envelope.correlationId,
            "requiresConfirmation" to envelope.requiresConfirmation,
            "issuedAt" to envelope.creationTime,
            "expirationTime" to envelope.expirationTime
        )

        val writeRes = runCatching { cmdRef.set(cmdDoc).await() }
        if (writeRes.isFailure) {
            val idToken = backendClient.getFreshIdToken().getOrNull()
            if (idToken == null) {
                return CommandResult(
                    success = false,
                    verified = false,
                    error = "Failed to dispatch command to Firestore: ${writeRes.exceptionOrNull()?.message}",
                    durationMs = System.currentTimeMillis() - startMs
                )
            }
            val payload = JSONObject().apply {
                put("commandId", envelope.commandId)
                put("sourceDeviceId", envelope.sourceDeviceId)
                put("targetDeviceId", envelope.targetDeviceId)
                put("actionType", envelope.actionType)
                put("protocolVersion", envelope.protocolVersion)
                put("parameters", JSONObject(envelope.parameters))
                put("requiresConfirmation", envelope.requiresConfirmation)
                put("issuedAt", envelope.creationTime)
                put("expirationTime", envelope.expirationTime)
                put("replayToken", envelope.replayToken)
                put("correlationId", envelope.correlationId)
            }
            val apiRes = backendClient.dispatchDeviceCommandOnBackend(idToken, payload)
            if (apiRes.isFailure) {
                return CommandResult(
                    success = false,
                    verified = false,
                    error = "Cross-device command dispatch failed: ${apiRes.exceptionOrNull()?.message}",
                    durationMs = System.currentTimeMillis() - startMs
                )
            }
        }

        val timeoutMs = (envelope.expirationTime - System.currentTimeMillis()).coerceIn(3_000L, 20_000L)
        val finalResult = withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine<CommandResult> { cont ->
                val reg = cmdRef.addSnapshotListener { snap, err ->
                    if (err != null) {
                        if (cont.isActive) {
                            cont.resume(
                                CommandResult(
                                    success = false,
                                    verified = false,
                                    error = "Control plane listener error: ${err.message}",
                                    durationMs = System.currentTimeMillis() - startMs
                                )
                            )
                        }
                        return@addSnapshotListener
                    }
                    if (snap == null || !snap.exists()) return@addSnapshotListener
                    val status = snap.getString("lifecycleState") ?: return@addSnapshotListener
                    when (status) {
                        "COMPLETED" -> {
                            val succeeded = snap.getBoolean("resultSuccess") ?: false
                            val verified = snap.getBoolean("resultVerified") ?: false
                            val output = snap.getString("resultSummary")
                                ?: "Action completed on ${envelope.targetDeviceId}."
                            val dur = snap.getLong("durationMs") ?: (System.currentTimeMillis() - startMs)
                            if (cont.isActive) {
                                cont.resume(
                                    CommandResult(
                                        success = succeeded,
                                        verified = verified,
                                        output = output,
                                        durationMs = dur
                                    )
                                )
                            }
                        }
                        "FAILED", "CANCELLED", "TIMED_OUT" -> {
                            val errMsg = snap.getString("resultError")
                                ?: "Command $status on ${envelope.targetDeviceId}."
                            val dur = snap.getLong("durationMs") ?: (System.currentTimeMillis() - startMs)
                            if (cont.isActive) {
                                cont.resume(
                                    CommandResult(
                                        success = false,
                                        verified = false,
                                        error = errMsg,
                                        durationMs = dur
                                    )
                                )
                            }
                        }
                    }
                }
                cont.invokeOnCancellation { reg.remove() }
            }
        }

        if (finalResult != null) return finalResult

        runCatching {
            cmdRef.update(
                mapOf(
                    "lifecycleState" to "TIMED_OUT",
                    "resultSuccess" to false,
                    "resultVerified" to false,
                    "resultError" to "Timed out waiting for target device (${envelope.targetDeviceId}).",
                    "completedAt" to System.currentTimeMillis()
                )
            ).await()
        }
        return CommandResult(
            success = false,
            verified = false,
            error = "Timed out waiting for target device (${envelope.targetDeviceId}) to execute ${envelope.actionType}. Verify the target device is online with Hub-Mind open.",
            durationMs = System.currentTimeMillis() - startMs
        )
    }

    override suspend fun reportProgress(commandId: String, state: CommandLifecycle, details: String) {
        val uid = activeUserId ?: return
        val db = backendClient?.getFirebaseFirestore()?.getOrNull() ?: return
        runCatching {
            db.collection("users")
                .document(uid)
                .collection("deviceCommands")
                .document(commandId)
                .update(
                    mapOf(
                        "lifecycleState" to state.name,
                        "progressDetails" to details,
                        "updatedAt" to System.currentTimeMillis()
                    )
                )
                .await()
        }
    }
}

enum class InternalJessDeviceTool {
    LIST_USER_DEVICES,
    GET_DEVICE_STATUS,
    GET_DEVICE_CAPABILITIES,
    PAIR_DEVICE,
    REVOKE_DEVICE,
    CONTROL_DEVICE,
    GET_DEVICE_SCREEN,
    SEND_TEXT_TO_DEVICE,
    OPEN_DEVICE_APP,
    GET_EXECUTION_STATUS,
    CANCEL_DEVICE_TASK
}

object JessDeviceResolver {
    fun resolveDeviceQuery(query: String, devices: List<DeviceNode>): DeviceNode? {
        val lower = query.lowercase()
        return when {
            lower.contains("phone") || lower.contains("android") || lower.contains("mobile") ->
                devices.find { it.platform == com.example.hubmind.data.model.DevicePlatform.ANDROID }
            lower.contains("laptop") || lower.contains("pc") || lower.contains("computer") || lower.contains("windows") || lower.contains("desktop") || lower.contains("workstation") ->
                devices.find { it.platform == com.example.hubmind.data.model.DevicePlatform.WINDOWS }
            else -> devices.firstOrNull { lower.contains(it.deviceName.lowercase()) } ?: devices.firstOrNull()
        }
    }
}
