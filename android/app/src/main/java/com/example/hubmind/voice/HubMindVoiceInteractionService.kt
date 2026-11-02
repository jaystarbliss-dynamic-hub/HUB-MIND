package com.example.hubmind.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import com.example.hubmind.MainActivity
import com.example.hubmind.di.ServiceLocator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class HubMindVoiceInteractionService : VoiceInteractionService() {
    override fun onReady() {
        super.onReady()
        ServiceLocator.initialize(applicationContext)
    }
}

class HubMindVoiceInteractionSessionService : VoiceInteractionSessionService() {
    override fun onNewSession(args: Bundle?): VoiceInteractionSession {
        return HubMindVoiceSession(this)
    }
}

class HubMindVoiceSession(context: Context) : VoiceInteractionSession(context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onShow(args: Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
        ServiceLocator.initialize(context.applicationContext)
        scope.launch {
            ServiceLocator.jessRepository.startVoiceSession()
        }
        runCatching {
            val launchIntent = Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra("trigger_jess_voice", true)
            }
            context.startActivity(launchIntent)
        }
    }

    override fun onHide() {
        super.onHide()
    }
}
