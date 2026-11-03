package com.example.hubmind.data.remote

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class HubMindFirebaseRuntimeConfig(
    val apiKey: String,
    val projectId: String,
    val appId: String,
    val messagingSenderId: String,
    val authDomain: String,
    val storageBucket: String,
    val firestoreDatabaseId: String,
    val googleClientId: String
)

data class EphemeralTokenResult(
    val token: String,
    val userId: String,
    val expiresAt: String?
)

data class JessFunctionCall(
    val id: String?,
    val name: String,
    val args: Map<String, Any>
)

data class JessChatTurnResult(
    val text: String,
    val functionCalls: List<JessFunctionCall>,
    val model: String?
)

class HubMindBackendClient(
    private val context: Context?,
    @Volatile var baseUrl: String = DEFAULT_BASE_URL
) {
    companion object {
        const val DEFAULT_BASE_URL = "https://hub-mind.netlify.app"
        const val CANONICAL_PROJECT_ID = "gen-lang-client-0197530608"
        const val CANONICAL_DATABASE_ID = "ai-studio-hubmind-4cac2024-c6eb-4208-80cf-928714dfd430"
        private const val FIREBASE_APP_NAME = "HubMindCanonical"
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }

    val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    @Volatile
    private var cachedConfig: HubMindFirebaseRuntimeConfig? = null

    @Volatile
    private var firebaseApp: FirebaseApp? = null

    suspend fun fetchAndValidateRuntimeConfig(forceRefresh: Boolean = false): Result<HubMindFirebaseRuntimeConfig> =
        withContext(Dispatchers.IO) {
            if (!forceRefresh) {
                cachedConfig?.let { return@withContext Result.success(it) }
            }
            runCatching {
                val cleanBase = baseUrl.trimEnd('/')
                val request = Request.Builder()
                    .url("$cleanBase/api/config")
                    .header("Accept", "application/json")
                    .header("Cache-Control", "no-cache")
                    .get()
                    .build()

                httpClient.newCall(request).execute().use { response ->
                    val bodyStr = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        throw IllegalStateException("Failed to load Hub-Mind runtime config (${response.code}): $bodyStr")
                    }
                    val root = JSONObject(bodyStr)
                    val fb = root.optJSONObject("firebase")
                        ?: throw IllegalStateException("Invalid /api/config response: missing 'firebase' object.")

                    val apiKey = fb.optString("apiKey", "").trim()
                    val projectId = fb.optString("projectId", CANONICAL_PROJECT_ID).trim()
                    val appId = fb.optString("appId", "").trim()
                    val messagingSenderId = fb.optString("messagingSenderId", "").trim()
                    val authDomain = fb.optString("authDomain", "$projectId.firebaseapp.com").trim()
                    val storageBucket = fb.optString("storageBucket", "$projectId.firebasestorage.app").trim()
                    val firestoreDatabaseId = fb.optString("firestoreDatabaseId", CANONICAL_DATABASE_ID).trim()
                    val googleClientId = root.optString("googleClientId", "").trim()

                    if (apiKey.isBlank() || apiKey == "dev-api-key" || apiKey == "test-api-key" || apiKey.startsWith("YOUR_")) {
                        throw IllegalStateException(
                            "Hub-Mind production Firebase API key is not configured on $cleanBase/api/config. Refusing placeholder credentials."
                        )
                    }
                    if (projectId.isBlank() || appId.isBlank()) {
                        throw IllegalStateException("Incomplete Firebase configuration from /api/config.")
                    }

                    val config = HubMindFirebaseRuntimeConfig(
                        apiKey = apiKey,
                        projectId = projectId,
                        appId = appId,
                        messagingSenderId = messagingSenderId,
                        authDomain = authDomain,
                        storageBucket = storageBucket,
                        firestoreDatabaseId = firestoreDatabaseId.ifBlank { CANONICAL_DATABASE_ID },
                        googleClientId = googleClientId
                    )
                    cachedConfig = config
                    ensureFirebaseInitialized(config)
                    config
                }
            }
        }

    @Synchronized
    private fun ensureFirebaseInitialized(config: HubMindFirebaseRuntimeConfig): FirebaseApp? {
        val ctx = context?.applicationContext ?: return null
        firebaseApp?.let { return it }

        val existing = FirebaseApp.getApps(ctx).firstOrNull { it.name == FIREBASE_APP_NAME }
        if (existing != null) {
            val options = existing.options
            if (options.projectId != config.projectId || options.applicationId != config.appId) {
                throw IllegalStateException("The existing Hub-Mind Firebase app is configured for a different project/app. Clear app data and reinstall the correctly configured build.")
            }
            firebaseApp = existing
            return existing
        }

        val options = FirebaseOptions.Builder()
            .setApiKey(config.apiKey)
            .setApplicationId(config.appId)
            .setProjectId(config.projectId)
            .setGcmSenderId(config.messagingSenderId.ifBlank { null })
            .setStorageBucket(config.storageBucket.ifBlank { null })
            .build()

        val initialized = FirebaseApp.initializeApp(ctx, options, FIREBASE_APP_NAME)
        firebaseApp = initialized
        return initialized
    }

    suspend fun getFirebaseAuth(): Result<FirebaseAuth> {
        val cfgRes = fetchAndValidateRuntimeConfig()
        return cfgRes.mapCatching { cfg ->
            val app = ensureFirebaseInitialized(cfg)
                ?: throw IllegalStateException("Android Context unavailable for FirebaseAuth initialization.")
            FirebaseAuth.getInstance(app)
        }
    }

    suspend fun getFirebaseFirestore(): Result<FirebaseFirestore> {
        val cfgRes = fetchAndValidateRuntimeConfig()
        return cfgRes.mapCatching { cfg ->
            val app = ensureFirebaseInitialized(cfg)
                ?: throw IllegalStateException("Android Context unavailable for FirebaseFirestore initialization.")
            if (cfg.firestoreDatabaseId.isBlank()) {
                throw IllegalStateException("The canonical Hub-Mind Firestore database ID is missing from runtime configuration.")
            }
            // Never fall back to (default): web and Android must use the same DB.
            FirebaseFirestore.getInstance(app, cfg.firestoreDatabaseId)
        }
    }

    suspend fun getFreshIdToken(forceRefresh: Boolean = false): Result<String> {
        val authRes = getFirebaseAuth()
        return authRes.mapCatching { auth ->
            val currentUser = auth.currentUser
                ?: throw IllegalStateException("Not signed in to Hub-Mind. Please sign in first.")
            val tokenResult = currentUser.getIdToken(forceRefresh).await()
            val token = tokenResult.token
            if (token.isNullOrBlank()) {
                throw IllegalStateException("Could not obtain a valid Firebase ID token.")
            }
            token
        }
    }

    suspend fun mintLiveEphemeralToken(idToken: String): Result<EphemeralTokenResult> =
        withContext(Dispatchers.IO) {
            runCatching {
                val cleanBase = baseUrl.trimEnd('/')
                val request = Request.Builder()
                    .url("$cleanBase/api/live-token")
                    .header("Authorization", "Bearer $idToken")
                    .header("Content-Type", "application/json")
                    .post("{}".toRequestBody(JSON_MEDIA_TYPE))
                    .build()

                httpClient.newCall(request).execute().use { response ->
                    val bodyStr = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        val errJson = runCatching { JSONObject(bodyStr).optString("error") }.getOrNull()
                        throw IllegalStateException(
                            errJson?.takeIf { it.isNotBlank() }
                                ?: "Failed to mint Gemini Live token (HTTP ${response.code})."
                        )
                    }
                    val json = JSONObject(bodyStr)
                    val token = json.optString("token", "").trim()
                    if (token.isBlank()) {
                        throw IllegalStateException("Server returned an empty Gemini Live token.")
                    }
                    EphemeralTokenResult(
                        token = token,
                        userId = json.optString("userId", ""),
                        expiresAt = json.optString("expiresAt", "").takeIf { it.isNotBlank() }
                    )
                }
            }
        }

    suspend fun sendChatTurn(
        idToken: String,
        messages: JSONArray,
        systemInstruction: String,
        toolsDeclarations: JSONArray? = null
    ): Result<JessChatTurnResult> = withContext(Dispatchers.IO) {
        runCatching {
            val cleanBase = baseUrl.trimEnd('/')
            val payload = JSONObject().apply {
                put("messages", messages)
                put("systemInstruction", systemInstruction)
                if (toolsDeclarations != null && toolsDeclarations.length() > 0) {
                    val toolsWrapper = JSONArray().apply {
                        put(JSONObject().apply {
                            put("functionDeclarations", toolsDeclarations)
                        })
                    }
                    put("tools", toolsWrapper)
                }
            }

            val request = Request.Builder()
                .url("$cleanBase/api/chat")
                .header("Authorization", "Bearer $idToken")
                .header("Content-Type", "application/json")
                .post(payload.toString().toRequestBody(JSON_MEDIA_TYPE))
                .build()

            httpClient.newCall(request).execute().use { response ->
                val bodyStr = response.body?.string().orEmpty()
                val json = runCatching { JSONObject(bodyStr) }.getOrNull()
                if (!response.isSuccessful) {
                    val errText = json?.optString("text")?.takeIf { it.isNotBlank() }
                        ?: json?.optString("error")?.takeIf { it.isNotBlank() }
                        ?: "Jess chat request failed (HTTP ${response.code})."
                    throw IllegalStateException(errText)
                }
                val replyText = json?.optString("text", "") ?: ""
                val callsArray = json?.optJSONArray("functionCalls")
                val parsedCalls = mutableListOf<JessFunctionCall>()
                if (callsArray != null) {
                    for (i in 0 until callsArray.length()) {
                        val fcObj = callsArray.optJSONObject(i) ?: continue
                        val name = fcObj.optString("name", "").trim()
                        if (name.isBlank()) continue
                        val argsObj = fcObj.optJSONObject("args")
                        val argsMap = mutableMapOf<String, Any>()
                        if (argsObj != null) {
                            val keys = argsObj.keys()
                            while (keys.hasNext()) {
                                val k = keys.next()
                                val v = argsObj.opt(k)
                                if (v != null && v != JSONObject.NULL) {
                                    argsMap[k] = v
                                }
                            }
                        }
                        parsedCalls.add(
                            JessFunctionCall(
                                id = fcObj.optString("id", "").takeIf { it.isNotBlank() },
                                name = name,
                                args = argsMap
                            )
                        )
                    }
                }
                JessChatTurnResult(
                    text = replyText,
                    functionCalls = parsedCalls,
                    model = json?.optString("model", "")?.takeIf { it.isNotBlank() }
                )
            }
        }
    }

    suspend fun registerDeviceOnBackend(idToken: String, devicePayload: JSONObject): Result<JSONObject> =
        withContext(Dispatchers.IO) {
            runCatching {
                val cleanBase = baseUrl.trimEnd('/')
                val request = Request.Builder()
                    .url("$cleanBase/api/devices/register")
                    .header("Authorization", "Bearer $idToken")
                    .header("Content-Type", "application/json")
                    .post(devicePayload.toString().toRequestBody(JSON_MEDIA_TYPE))
                    .build()
                httpClient.newCall(request).execute().use { response ->
                    val bodyStr = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        throw IllegalStateException("Device registration failed (${response.code}): $bodyStr")
                    }
                    JSONObject(bodyStr.ifBlank { "{}" })
                }
            }
        }

    suspend fun dispatchDeviceCommandOnBackend(idToken: String, commandPayload: JSONObject): Result<JSONObject> =
        withContext(Dispatchers.IO) {
            runCatching {
                val cleanBase = baseUrl.trimEnd('/')
                val request = Request.Builder()
                    .url("$cleanBase/api/devices/dispatch")
                    .header("Authorization", "Bearer $idToken")
                    .header("Content-Type", "application/json")
                    .post(commandPayload.toString().toRequestBody(JSON_MEDIA_TYPE))
                    .build()
                httpClient.newCall(request).execute().use { response ->
                    val bodyStr = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        throw IllegalStateException("Command dispatch failed (${response.code}): $bodyStr")
                    }
                    JSONObject(bodyStr.ifBlank { "{}" })
                }
            }
        }

    suspend fun updateDeviceCommandOnBackend(idToken: String, updatePayload: JSONObject): Result<JSONObject> =
        withContext(Dispatchers.IO) {
            runCatching {
                val cleanBase = baseUrl.trimEnd('/')
                val request = Request.Builder()
                    .url("$cleanBase/api/devices")
                    .header("Authorization", "Bearer $idToken")
                    .header("Content-Type", "application/json")
                    .patch(updatePayload.toString().toRequestBody(JSON_MEDIA_TYPE))
                    .build()
                httpClient.newCall(request).execute().use { response ->
                    val bodyStr = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        throw IllegalStateException("Command status update failed (${response.code}): $bodyStr")
                    }
                    JSONObject(bodyStr.ifBlank { "{}" })
                }
            }
        }
}
