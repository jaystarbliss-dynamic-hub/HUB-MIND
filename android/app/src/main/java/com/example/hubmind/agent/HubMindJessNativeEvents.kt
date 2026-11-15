package com.example.hubmind.agent

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.atomic.AtomicLong

data class HubMindJessNativeGesture(
    val id: Long,
    val gesture: String
)

/**
 * Small in-process event bus between the system overlay and the one authenticated
 * WebView. A pending gesture survives Activity recreation inside the process and
 * is consumed exactly once. The React workspace remains the sole owner of Jess's
 * Gemini Live/audio session.
 */
object HubMindJessNativeEvents {
    private val nextId = AtomicLong(0L)
    private val mutableEvents = MutableStateFlow<HubMindJessNativeGesture?>(null)
    val events = mutableEvents.asStateFlow()

    fun dispatch(gesture: String) {
        if (gesture !in setOf("toggle", "mute", "stop")) return
        mutableEvents.value = HubMindJessNativeGesture(nextId.incrementAndGet(), gesture)
    }

    fun consume(event: HubMindJessNativeGesture): Boolean {
        val current = mutableEvents.value ?: return false
        if (current.id != event.id) return false
        mutableEvents.value = null
        return true
    }
}
