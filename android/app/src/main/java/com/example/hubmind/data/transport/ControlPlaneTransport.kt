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
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.util.Collections
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume

enum class CommandLifecycle {
    CREATED,
    AUTHENTICATED,
    ROUTED,
    RECEIVED,
    AWAITING_CONFIRMATION,
    EXECUTING,
    COMPLETED,
    FAILED,
    CANCELLED,
    EXPIRED,
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

    fun getPublicKeyFingerprint(): String {
        return try {
            val keyStore = KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)
            val cert = keyStore.getCertificate(KEY_ALIAS)
            cert?.publicKey?.encoded?.take(8)?.joinToString("") { "%02x".format(it) } ?: "hw-sec-key"
        } catch (e: Exception) {
            "hw-sec-key"
        }
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
        processedCommandIds.clear()
        processedReplayTokens.clear()
        KeystorePairingManager.generateDeviceKeyPair()

        val client = backendClient
        if (client == null) {
            _isConnected.value = true
            return
        }

        val db = client.getFirebaseFirestore().getOrNull()
        val authUid = client.getFirebaseAuth().getOrNull()?.currentUser?.uid
        if (db == null || authUid != userId) {
            _isConnected.value = false
            return
        }

        incomingListener?.remove()
        incomingListener = db.collection("users")
            .document(userId)
            .collection("deviceCommands")
            .whereEqualTo("targetDeviceId", deviceId)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    _isConnected.value = false
                    return@addSnapshotListener
                }
                _isConnected.value = true
                val docs = snapshot?.documents ?: return@addSnapshotListener
                for (doc in docs) {
                    if (doc.getString("lifecycleState") != "DISPATCHED") continue
                    val commandId = doc.getString("commandId") ?: doc.id
                    if (!processedCommandIds.add(commandId)) continue
                    scope.launch {
                        executeIncomingCommand(userId, deviceId, doc.reference, commandId)
                    }
                }
            }
    }

    private suspend fun executeIncomingCommand(
        userId: String,
        deviceId: String,
        commandRef: com.google.firebase.firestore.DocumentReference,
        commandId: String
    ) {
        val db = backendClient?.getFirebaseFirestore()?.getOrNull() ?: return
        val startMs = System.currentTimeMillis()
        val snapshot = runCatching { commandRef.get().await() }.getOrNull() ?: return
        if (!snapshot.exists() || snapshot.getString("lifecycleState") != "DISPATCHED") return

        val issuingUserId = snapshot.getString("issuingUserId").orEmpty()
        val sourceDeviceId = snapshot.getString("sourceDeviceId").orEmpty()
        val targetDeviceId = snapshot.getString("targetDeviceId").orEmpty()
        val actionType = snapshot.getString("actionType").orEmpty()
        val replayToken = snapshot.getString("replayToken").orEmpty()
        val expirationTime = snapshot.getLong("expirationTime") ?: 0L
        val requiresConfirmation = snapshot.getBoolean("requiresConfirmation") ?: false

        if (issuingUserId != userId || targetDeviceId != deviceId || sourceDeviceId.isBlank() || actionType.isBlank()) {
            writeCommandResult(userId, commandId, "FAILED", false, false, "",
                "Command envelope identity or target validation failed.")
            return
        }
        val sourceDeviceRegistered = runCatching {
            db.collection("users").document(userId).collection("devices")
                .document(sourceDeviceId).get().await().exists()
        }.getOrDefault(false)
        if (!sourceDeviceRegistered) {
            writeCommandResult(userId, commandId, "FAILED", false, false, "",
                "Command source device is not registered to this Hub-Mind user.")
            return
        }
        if (expirationTime <= System.currentTimeMillis()) {
            writeCommandResult(userId, commandId, "TIMED_OUT", false, false, "",
                "Command expired before Android execution began.")
            return
        }
        if (replayToken.isBlank() || !processedReplayTokens.add(replayToken)) {
            writeCommandResult(userId, commandId, "FAILED", false, false, "",
                "Duplicate or missing replay token rejected by Android.")
            return
        }
        if (requiresConfirmation) {
            writeCommandResult(userId, commandId, "FAILED", false, false, "",
                "This command requires explicit user confirmation. The Android receiver has no pending-approval surface in this build, so it was not executed.")
            return
        }

        // Transactionally claim the command so reconnects cannot execute it twice.
        val claimed = runCatching {
            db.runTransaction { transaction ->
                val current = transaction.get(commandRef)
                if (!current.exists() || current.getString("lifecycleState") != "DISPATCHED") {
                    false
                } else if (
                    current.getString("issuingUserId") != userId ||
                    current.getString("targetDeviceId") != deviceId ||
                    (current.getLong("expirationTime") ?: 0L) <= System.currentTimeMillis()
                ) {
                    false
                } else {
                    transaction.update(commandRef, mapOf(
                        "lifecycleState" to "EXECUTING",
                        "claimedByDeviceId" to deviceId,
                        "claimedAt" to System.currentTimeMillis()
                    ))
                    true
                }
            }.await()
        }.getOrDefault(false)

        if (!claimed) return

        val paramsJson = snapshot.getString("parametersJson").orEmpty()
        val parameters = try {
            JSONObject(paramsJson.ifBlank { "{}" }).toNativeMap()
        } catch (error: Exception) {
            writeCommandResult(userId, commandId, "FAILED", false, false, "",
                "Command parameters were not valid JSON: ${error.message ?: "parse error"}")
            return
        }

        if (actionType.equals("ping_device", ignoreCase = true) || actionType.equals("PING", ignoreCase = true)) {
            val duration = System.currentTimeMillis() - startMs
            writeCommandResult(userId, commandId, "COMPLETED", true, true,
                "Pong from Android device $deviceId.", "", duration)
            return
        }

        val mappedAction = mapActionName(actionType, parameters)
        if (mappedAction == null) {
            writeCommandResult(userId, commandId, "FAILED", false, false, "",
                "Unsupported Android action '$actionType'. No fallback action was executed.")
            return
        }

        val executor = localExecutor
        if (executor == null) {
            writeCommandResult(userId, commandId, "FAILED", false, false, "",
                "AndroidUiActionExecutor is not initialized on this device.")
            return
        }

        val command = AndroidCommand(
            commandId = commandId,
            actionType = mappedAction,
            parameters = parameters,
            expiryTimestamp = expirationTime,
            requiresConfirmation = false
        )
        val result = runCatching { executor.executeCommand(command) }.getOrElse { error ->
            writeCommandResult(userId, commandId, "FAILED", false, false, "",
                error.message ?: "Android action execution failed.")
            return
        }

        val duration = System.currentTimeMillis() - startMs
        val payloadJson = result.screenshotBase64
            ?.takeIf { it.length <= 450_000 }
            ?.let { image ->
                JSONObject().put(
                    "evidence",
                    JSONObject().put("imageBase64", image).put("mimeType", "image/jpeg")
                ).toString()
            }
        writeCommandResult(
            userId = userId,
            commandId = commandId,
            lifecycleState = if (result.success) "COMPLETED" else "FAILED",
            success = result.success,
            verified = result.verified,
            summary = result.outputText.orEmpty(),
            error = result.error.orEmpty(),
            durationMs = duration,
            resultPayloadJson = payloadJson
        )
    }

    private fun JSONObject.toNativeMap(): Map<String, Any> {
        val result = mutableMapOf<String, Any>()
        val keys = keys()
        while (keys.hasNext()) {
            val key = keys.next()
            when (val value = opt(key)) {
                null, JSONObject.NULL -> Unit
                is JSONObject -> result[key] = value.toNativeMap()
                is JSONArray -> result[key] = value.toNativeList()
                else -> result[key] = value
            }
        }
        return result
    }

    private fun JSONArray.toNativeList(): List<Any> {
        val result = mutableListOf<Any>()
        for (index in 0 until length()) {
            when (val value = opt(index)) {
                null, JSONObject.NULL -> Unit
                is JSONObject -> result.add(value.toNativeMap())
                is JSONArray -> result.add(value.toNativeList())
                else -> result.add(value)
            }
        }
        return result
    }

    private suspend fun writeCommandResult(
        userId: String,
        commandId: String,
        lifecycleState: String,
        success: Boolean,
        verified: Boolean,
        summary: String,
        error: String,
        durationMs: Long = 0,
        resultPayloadJson: String? = null
    ) {
        val update = mutableMapOf<String, Any>(
            "lifecycleState" to lifecycleState,
            "resultSuccess" to success,
            "resultVerified" to verified,
            "resultSummary" to summary.take(10_000),
            "resultError" to error.take(5_000),
            "completedAt" to System.currentTimeMillis(),
            "durationMs" to durationMs
        )
        resultPayloadJson?.takeIf { it.length <= 500_000 }?.let { update["resultPayloadJson"] = it }

        val db = backendClient?.getFirebaseFirestore()?.getOrNull()
        val write = if (db != null) runCatching {
            db.collection("users").document(userId).collection("deviceCommands")
                .document(commandId).update(update).await()
        } else Result.failure<Unit>(IllegalStateException("Firestore unavailable"))

        if (write.isFailure) {
            val token = backendClient?.getFreshIdToken()?.getOrNull() ?: return
            backendClient.updateDeviceCommandOnBackend(
                token,
                JSONObject().apply {
                    put("commandId", commandId)
                    put("lifecycleState", lifecycleState)
                    put("resultSuccess", success)
                    put("resultVerified", verified)
                    put("resultSummary", summary.take(10_000))
                    put("resultError", error.take(5_000))
                    put("durationMs", durationMs)
                    resultPayloadJson?.takeIf { it.length <= 500_000 }?.let { put("resultPayloadJson", it) }
                }
            )
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
            "SET_VOLUME" -> AndroidActionType.SET_VOLUME
            "GET_DEVICE_STATUS" -> AndroidActionType.GET_DEVICE_STATUS
            else -> null
        }
    }

    override suspend fun disconnect() {
        incomingListener?.remove()
        incomingListener = null
        activeUserId = null
        activeDeviceId = null
        processedCommandIds.clear()
        processedReplayTokens.clear()
        _isConnected.value = false
    }

    override suspend fun dispatchCommand(envelope: CommandEnvelope): CommandResult {
        val startMs = System.currentTimeMillis()
        if (envelope.expirationTime <= startMs) {
            return CommandResult(false, false, error = "Command envelope expired before dispatch.", durationMs = 0)
        }
        if (envelope.replayToken.isBlank()) {
            return CommandResult(false, false, error = "Missing replayToken; command rejected.")
        }
        if (!processedReplayTokens.add(envelope.replayToken)) {
            return CommandResult(false, false, error = "Duplicate replayToken; command rejected.")
        }
        if (backendClient == null) {
            // Deterministic unit-test fallback only; production always injects HubMindBackendClient.
            return CommandResult(
                success = true,
                verified = true,
                output = "Test transport accepted ${envelope.actionType} for ${envelope.targetDeviceId}.",
                durationMs = 25
            )
        }

        val client = backendClient
        val authUid = client.getFirebaseAuth().getOrNull()?.currentUser?.uid
        val uid = activeUserId
        val sourceDeviceId = activeDeviceId
        if (authUid.isNullOrBlank() || uid != authUid || envelope.issuingUserId != authUid) {
            return CommandResult(false, false, error = "Command issuer is not the active authenticated Hub-Mind user.")
        }
        if (sourceDeviceId.isNullOrBlank() || envelope.sourceDeviceId != sourceDeviceId) {
            return CommandResult(false, false, error = "Command source device does not match this paired Android device.")
        }
        if (envelope.targetDeviceId.isBlank() || envelope.targetDeviceId == sourceDeviceId) {
            return CommandResult(false, false, error = "A valid remote target device is required.")
        }

        val db = client.getFirebaseFirestore().getOrNull()
            ?: return CommandResult(false, false, error = "Hub-Mind Firestore is unavailable.")
        val devicesRef = db.collection("users").document(uid).collection("devices")
        val target = runCatching { devicesRef.document(envelope.targetDeviceId).get().await() }.getOrNull()
            ?: return CommandResult(false, false, error = "Could not verify the target device registration.")
        if (!target.exists()) {
            return CommandResult(false, false, error = "Target device is not registered to this Hub-Mind account.")
        }
        val targetStatus = target.getString("status")?.uppercase().orEmpty()
        val targetLastSeen = target.getLong("lastSeen") ?: target.getLong("lastSeenAt") ?: 0L
        if (targetStatus !in setOf("ONLINE", "BUSY") || targetLastSeen <= 0L || startMs - targetLastSeen > 60_000L) {
            return CommandResult(false, false, error = "Target device is offline or its presence heartbeat is stale.")
        }

        val commandRef = db.collection("users").document(uid)
            .collection("deviceCommands").document(envelope.commandId)
        val commandDoc = mapOf(
            "commandId" to envelope.commandId,
            "protocolVersion" to envelope.protocolVersion,
            "issuingUserId" to uid,
            "sourceDeviceId" to sourceDeviceId,
            "targetDeviceId" to envelope.targetDeviceId,
            "actionType" to envelope.actionType,
            "parametersJson" to JSONObject(envelope.parameters).toString(),
            "lifecycleState" to "DISPATCHED",
            "requiresConfirmation" to envelope.requiresConfirmation,
            "issuedAt" to envelope.creationTime,
            "expirationTime" to envelope.expirationTime,
            "replayToken" to envelope.replayToken,
            "correlationId" to envelope.correlationId
        )

        val directWrite = runCatching { commandRef.set(commandDoc).await() }
        if (directWrite.isFailure) {
            val token = client.getFreshIdToken().getOrNull()
                ?: return CommandResult(
                    false, false,
                    error = "Firestore command write failed and no fresh Firebase token is available: ${directWrite.exceptionOrNull()?.message}",
                    durationMs = System.currentTimeMillis() - startMs
                )
            val apiPayload = JSONObject().apply {
                put("commandId", envelope.commandId)
                put("protocolVersion", envelope.protocolVersion)
                put("sourceDeviceId", sourceDeviceId)
                put("targetDeviceId", envelope.targetDeviceId)
                put("actionType", envelope.actionType)
                put("parameters", JSONObject(envelope.parameters))
                put("requiresConfirmation", envelope.requiresConfirmation)
                put("issuedAt", envelope.creationTime)
                put("expirationTime", envelope.expirationTime)
                put("replayToken", envelope.replayToken)
                put("correlationId", envelope.correlationId)
            }
            val apiResult = client.dispatchDeviceCommandOnBackend(token, apiPayload)
            if (apiResult.isFailure) {
                return CommandResult(false, false, error = "Cross-device dispatch failed: ${apiResult.exceptionOrNull()?.message}")
            }
        }

        val timeoutMs = (envelope.expirationTime - System.currentTimeMillis()).coerceAtLeast(1_000L)
        val result = withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine<CommandResult> { continuation ->
                val registration = commandRef.addSnapshotListener { snapshot, error ->
                    if (error != null) {
                        if (continuation.isActive) continuation.resume(
                            CommandResult(false, false, error = "Command result listener failed: ${error.message}")
                        )
                        return@addSnapshotListener
                    }
                    if (snapshot == null || !snapshot.exists() || !continuation.isActive) return@addSnapshotListener
                    when (snapshot.getString("lifecycleState")) {
                        "COMPLETED" -> continuation.resume(
                            CommandResult(
                                success = snapshot.getBoolean("resultSuccess") ?: false,
                                verified = snapshot.getBoolean("resultVerified") ?: false,
                                output = snapshot.getString("resultSummary"),
                                error = snapshot.getString("resultError")?.takeIf { it.isNotBlank() },
                                durationMs = snapshot.getLong("durationMs") ?: (System.currentTimeMillis() - startMs)
                            )
                        )
                        "FAILED", "CANCELLED", "TIMED_OUT" -> continuation.resume(
                            CommandResult(
                                success = false,
                                verified = false,
                                error = snapshot.getString("resultError")?.takeIf { it.isNotBlank() }
                                    ?: "Target device reported ${snapshot.getString("lifecycleState")}.",
                                durationMs = snapshot.getLong("durationMs") ?: (System.currentTimeMillis() - startMs)
                            )
                        )
                    }
                }
                continuation.invokeOnCancellation { registration.remove() }
            }
        }

        if (result != null) return result
        val timeoutMessage = "Timed out waiting for target device ${envelope.targetDeviceId}."
        writeCommandResult(uid, envelope.commandId, "TIMED_OUT", false, false, "", timeoutMessage)
        return CommandResult(false, false, error = timeoutMessage, durationMs = System.currentTimeMillis() - startMs)
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
