package com.example.hubmind.voice

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.util.Base64
import androidx.core.content.ContextCompat
import com.example.hubmind.data.model.JessLiveState
import com.example.hubmind.data.model.LiveConnectionState
import com.example.hubmind.data.remote.JessFunctionCall
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

interface GeminiLiveCallbacks {
    fun onConnectionStateChanged(state: LiveConnectionState)
    fun onJessStateChanged(state: JessLiveState)
    fun onUserTranscript(text: String)
    fun onJessTranscript(text: String)
    fun onTurnComplete()
    fun onToolCall(call: JessFunctionCall, respond: (Map<String, Any?>) -> Unit)
    fun onError(message: String)
}

class GeminiLiveAudioSession(
    private val context: Context?,
    private val httpClient: OkHttpClient,
    private val callbacks: GeminiLiveCallbacks
) {
    companion object {
        private const val INPUT_SAMPLE_RATE = 16000
        private const val OUTPUT_SAMPLE_RATE = 24000
        private const val FRAME_SAMPLES = 1024 // ~64ms at 16kHz
        private const val LIVE_MODEL = "models/gemini-3.8-live"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var webSocket: WebSocket? = null
    private var captureJob: Job? = null
    private var audioRecord: AudioRecord? = null
    private var audioTrack: AudioTrack? = null
    private var echoCanceler: AcousticEchoCanceler? = null
    private var noiseSuppressor: NoiseSuppressor? = null
    private var autoGainControl: AutomaticGainControl? = null

    private val isConnected = AtomicBoolean(false)
    private val isSetupComplete = AtomicBoolean(false)
    private val isMuted = AtomicBoolean(false)
    @Volatile
    private var sessionResumptionHandle: String? = null

    fun connect(
        ephemeralToken: String,
        systemInstruction: String,
        toolDeclarations: JSONArray
    ) {
        disconnect(clearResumption = false)
        callbacks.onConnectionStateChanged(LiveConnectionState.CONNECTING)
        callbacks.onJessStateChanged(JessLiveState.THINKING)

        val wsUrl = "wss://generativelanguage.googleapis.com/ws/" +
            "google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained" +
            "?access_token=$ephemeralToken"

        val request = Request.Builder()
            .url(wsUrl)
            .build()

        webSocket = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                isConnected.set(true)
                initAudioTrack()
                sendSetupFrame(webSocket, systemInstruction, toolDeclarations)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleServerFrame(webSocket, text)
            }

            override fun onMessage(webSocket: WebSocket, bytes: okio.ByteString) {
                handleServerFrame(webSocket, bytes.utf8())
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                isConnected.set(false)
                isSetupComplete.set(false)
                stopAudioCapture()
                stopAudioPlayback()
                callbacks.onConnectionStateChanged(LiveConnectionState.DISCONNECTED)
                callbacks.onJessStateChanged(JessLiveState.IDLE)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                isConnected.set(false)
                isSetupComplete.set(false)
                stopAudioCapture()
                stopAudioPlayback()
                callbacks.onError(t.message ?: "Gemini Live WebSocket connection failed.")
                callbacks.onConnectionStateChanged(LiveConnectionState.ERROR)
                callbacks.onJessStateChanged(JessLiveState.ERROR)
            }
        })
    }

    private fun sendSetupFrame(
        ws: WebSocket,
        systemInstruction: String,
        toolDeclarations: JSONArray
    ) {
        val setupObj = JSONObject().apply {
            put("model", LIVE_MODEL)
            put("generationConfig", JSONObject().apply {
                put("responseModalities", JSONArray().put("AUDIO"))
                put("speechConfig", JSONObject().apply {
                    put("voiceConfig", JSONObject().apply {
                        put("prebuiltVoiceConfig", JSONObject().apply {
                            put("voiceName", "Kore")
                        })
                    })
                })
            })
            put("inputAudioTranscription", JSONObject())
            put("outputAudioTranscription", JSONObject())
            put("contextWindowCompression", JSONObject().apply {
                put("slidingWindow", JSONObject())
            })
            sessionResumptionHandle?.let { handle ->
                put("sessionResumption", JSONObject().apply {
                    put("handle", handle)
                })
            }
            put("systemInstruction", JSONObject().apply {
                put("parts", JSONArray().put(JSONObject().put("text", systemInstruction)))
            })
            if (toolDeclarations.length() > 0) {
                put("tools", JSONArray().put(JSONObject().put("functionDeclarations", toolDeclarations)))
            }
        }
        val root = JSONObject().put("setup", setupObj)
        ws.send(root.toString())
    }

    private fun handleServerFrame(ws: WebSocket, rawText: String) {
        val json = runCatching { JSONObject(rawText) }.getOrNull() ?: return

        if (json.has("setupComplete")) {
            isSetupComplete.set(true)
            callbacks.onConnectionStateChanged(LiveConnectionState.CONNECTED)
            val startedMic = startAudioCapture()
            if (startedMic) {
                callbacks.onJessStateChanged(if (isMuted.get()) JessLiveState.MUTED else JessLiveState.LISTENING)
            } else {
                callbacks.onJessStateChanged(JessLiveState.MUTED)
            }
            return
        }

        val resumption = json.optJSONObject("sessionResumptionUpdate")
            ?: json.optJSONObject("session_resumption_update")
        if (resumption != null && resumption.optBoolean("resumable", false)) {
            val newHandle = resumption.optString("newHandle", "").trim()
            if (newHandle.isNotBlank()) {
                sessionResumptionHandle = newHandle
            }
        }

        val serverContent = json.optJSONObject("serverContent")
        if (serverContent != null) {
            val inputTx = serverContent.optJSONObject("inputTranscription")?.optString("text")
                ?: serverContent.optJSONObject("inputAudioTranscription")?.optString("text")
            if (!inputTx.isNullOrBlank()) {
                callbacks.onUserTranscript(inputTx)
            }

            val outputTx = serverContent.optJSONObject("outputTranscription")?.optString("text")
                ?: serverContent.optJSONObject("outputAudioTranscription")?.optString("text")
            if (!outputTx.isNullOrBlank()) {
                callbacks.onJessTranscript(outputTx)
            }

            if (serverContent.optBoolean("interrupted", false)) {
                flushAudioPlayback()
                callbacks.onJessStateChanged(JessLiveState.INTERRUPTED)
                scope.launch {
                    delay(200)
                    if (isConnected.get()) {
                        callbacks.onJessStateChanged(
                            if (isMuted.get()) JessLiveState.MUTED else JessLiveState.LISTENING
                        )
                    }
                }
                return
            }

            val modelTurn = serverContent.optJSONObject("modelTurn")
            val parts = modelTurn?.optJSONArray("parts")
            if (parts != null) {
                for (i in 0 until parts.length()) {
                    val part = parts.optJSONObject(i) ?: continue
                    val inlineData = part.optJSONObject("inlineData")
                    if (inlineData != null) {
                        val b64 = inlineData.optString("data", "")
                        if (b64.isNotBlank()) {
                            callbacks.onJessStateChanged(JessLiveState.SPEAKING)
                            playPcm24kBase64(b64)
                        }
                    }
                    val textPart = part.optString("text", "")
                    if (textPart.isNotBlank()) {
                        callbacks.onJessTranscript(textPart)
                    }
                }
            }

            if (serverContent.optBoolean("turnComplete", false)) {
                callbacks.onTurnComplete()
                if (isConnected.get()) {
                    callbacks.onJessStateChanged(
                        if (isMuted.get()) JessLiveState.MUTED else JessLiveState.LISTENING
                    )
                }
            }
        }

        val toolCall = json.optJSONObject("toolCall")
        val functionCalls = toolCall?.optJSONArray("functionCalls")
        if (functionCalls != null && functionCalls.length() > 0) {
            callbacks.onJessStateChanged(JessLiveState.THINKING)
            for (i in 0 until functionCalls.length()) {
                val fc = functionCalls.optJSONObject(i) ?: continue
                val id = fc.optString("id", "").takeIf { it.isNotBlank() }
                val name = fc.optString("name", "").trim()
                if (name.isBlank()) continue
                val argsObj = fc.optJSONObject("args")
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
                val call = JessFunctionCall(id = id, name = name, args = argsMap)
                callbacks.onToolCall(call) { responseMap ->
                    sendToolResponse(ws, id, name, responseMap)
                }
            }
        }
    }

    private fun sendToolResponse(
        ws: WebSocket,
        callId: String?,
        name: String,
        responseMap: Map<String, Any?>
    ) {
        val respJson = JSONObject()
        for ((k, v) in responseMap) {
            respJson.put(k, v ?: JSONObject.NULL)
        }
        val fnResp = JSONObject().apply {
            if (!callId.isNullOrBlank()) put("id", callId)
            put("name", name)
            put("response", JSONObject().put("result", respJson))
        }
        val payload = JSONObject().put(
            "toolResponse",
            JSONObject().put("functionResponses", JSONArray().put(fnResp))
        )
        ws.send(payload.toString())
    }

    fun sendClientTextPrompt(prompt: String) {
        val ws = webSocket ?: return
        if (!isConnected.get()) return
        val clientContent = JSONObject().apply {
            put("turns", JSONArray().put(JSONObject().apply {
                put("role", "user")
                put("parts", JSONArray().put(JSONObject().put("text", prompt)))
            }))
            put("turnComplete", true)
        }
        ws.send(JSONObject().put("clientContent", clientContent).toString())
    }

    fun setMuted(muted: Boolean) {
        isMuted.set(muted)
        if (isConnected.get()) {
            callbacks.onJessStateChanged(if (muted) JessLiveState.MUTED else JessLiveState.LISTENING)
        }
    }

    fun interruptPlayback() {
        flushAudioPlayback()
        if (isConnected.get()) {
            callbacks.onJessStateChanged(if (isMuted.get()) JessLiveState.MUTED else JessLiveState.LISTENING)
        }
    }

    @SuppressLint("MissingPermission")
    private fun startAudioCapture(): Boolean {
        val ctx = context ?: return false
        val hasAudioPerm = ContextCompat.checkSelfPermission(
            ctx,
            android.Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
        if (!hasAudioPerm) {
            callbacks.onError("Microphone permission (RECORD_AUDIO) is required for live voice.")
            return false
        }

        stopAudioCapture()

        val minBufSize = AudioRecord.getMinBufferSize(
            INPUT_SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        if (minBufSize <= 0) return false

        val bufferSize = maxOf(minBufSize * 2, FRAME_SAMPLES * 4)
        val recorder = try {
            AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                INPUT_SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSize
            )
        } catch (e: Throwable) {
            callbacks.onError("Could not initialize Android microphone: ${e.message}")
            return false
        }

        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            recorder.release()
            return false
        }

        val sessionId = recorder.audioSessionId
        runCatching {
            if (AcousticEchoCanceler.isAvailable()) {
                echoCanceler = AcousticEchoCanceler.create(sessionId)?.apply { enabled = true }
            }
            if (NoiseSuppressor.isAvailable()) {
                noiseSuppressor = NoiseSuppressor.create(sessionId)?.apply { enabled = true }
            }
            if (AutomaticGainControl.isAvailable()) {
                autoGainControl = AutomaticGainControl.create(sessionId)?.apply { enabled = true }
            }
        }

        audioRecord = recorder
        recorder.startRecording()

        captureJob = scope.launch {
            val shortBuf = ShortArray(FRAME_SAMPLES)
            val byteBuf = ByteArray(FRAME_SAMPLES * 2)
            while (isActive && isConnected.get()) {
                val read = recorder.read(shortBuf, 0, FRAME_SAMPLES)
                if (read > 0 && !isMuted.get() && isSetupComplete.get()) {
                    var byteIdx = 0
                    for (i in 0 until read) {
                        val s = shortBuf[i].toInt()
                        byteBuf[byteIdx++] = (s and 0xFF).toByte()
                        byteBuf[byteIdx++] = ((s shr 8) and 0xFF).toByte()
                    }
                    val encoded = Base64.encodeToString(byteBuf, 0, read * 2, Base64.NO_WRAP)
                    val chunk = JSONObject().apply {
                        put("mimeType", "audio/pcm;rate=16000")
                        put("data", encoded)
                    }
                    val frame = JSONObject().put(
                        "realtimeInput",
                        JSONObject().put("mediaChunks", JSONArray().put(chunk))
                    )
                    webSocket?.send(frame.toString())
                } else if (read <= 0) {
                    delay(20)
                }
            }
        }
        return true
    }

    private fun stopAudioCapture() {
        captureJob?.cancel()
        captureJob = null
        runCatching { echoCanceler?.release() }
        echoCanceler = null
        runCatching { noiseSuppressor?.release() }
        noiseSuppressor = null
        runCatching { autoGainControl?.release() }
        autoGainControl = null
        runCatching {
            audioRecord?.stop()
            audioRecord?.release()
        }
        audioRecord = null
    }

    private fun initAudioTrack() {
        if (context == null) return
        stopAudioPlayback()
        val minBuf = AudioTrack.getMinBufferSize(
            OUTPUT_SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        if (minBuf <= 0) return

        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(OUTPUT_SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(maxOf(minBuf * 2, OUTPUT_SAMPLE_RATE * 2))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()

        track.play()
        audioTrack = track
    }

    private fun playPcm24kBase64(base64Audio: String) {
        val track = audioTrack ?: return
        runCatching {
            val pcmBytes = Base64.decode(base64Audio, Base64.DEFAULT)
            track.write(pcmBytes, 0, pcmBytes.size)
        }
    }

    private fun flushAudioPlayback() {
        val track = audioTrack ?: return
        runCatching {
            track.pause()
            track.flush()
            track.play()
        }
    }

    private fun stopAudioPlayback() {
        runCatching {
            audioTrack?.pause()
            audioTrack?.flush()
            audioTrack?.release()
        }
        audioTrack = null
    }

    fun disconnect(clearResumption: Boolean = true) {
        isConnected.set(false)
        isSetupComplete.set(false)
        if (clearResumption) {
            sessionResumptionHandle = null
        }
        stopAudioCapture()
        stopAudioPlayback()
        runCatching { webSocket?.close(1000, "Session ended") }
        webSocket = null
    }

    fun shutdown() {
        disconnect(clearResumption = true)
        scope.cancel()
    }
}
