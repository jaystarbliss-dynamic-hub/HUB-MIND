package com.example.hubmind.agent

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Small in-process event bus between the system overlay and the one authenticated
 * WebView. Gestures are deliberately commands only; the React workspace remains
 * the sole owner of Jess's Gemini Live/audio session.
 */
object HubMindJessNativeEvents {
    private val mutableEvents = MutableSharedFlow<String>(extraBufferCapacity = 16)
    val events = mutableEvents.asSharedFlow()

    fun dispatch(gesture: String) {
        if (gesture !in setOf("toggle", "mute", "stop")) return
        mutableEvents.tryEmit(gesture)
    }
}
