package com.example.hubmind.voice

import android.content.Context
import com.example.hubmind.data.model.JessLiveState
import com.example.hubmind.data.model.LiveConnectionState
import com.example.hubmind.data.repository.JessRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Coordinates Android voice interaction with the canonical Gemini Live session
 * managed by [JessRepository] (`GeminiLiveAudioSession` via `/api/live-token`).
 */
class VoiceInteractionManager(
    private val context: Context,
    private val jessRepository: JessRepository
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    val liveState: StateFlow<JessLiveState> = jessRepository.liveState
    val connectionState: StateFlow<LiveConnectionState> = jessRepository.connectionState

    private val _partialTranscript = MutableStateFlow("")
    val partialTranscript: StateFlow<String> = _partialTranscript.asStateFlow()

    fun startLiveSession(onStarted: (Boolean) -> Unit = {}) {
        scope.launch {
            val ok = jessRepository.startVoiceSession()
            onStarted(ok)
        }
    }

    fun cancelSession() {
        scope.launch {
            jessRepository.endVoiceSession()
            _partialTranscript.value = ""
        }
    }

    fun destroy() {
        cancelSession()
    }
}
