package com.example.hubmind.agent

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.example.hubmind.MainActivity

/** Foreground lifetime for the existing device agent, Jess microphone and opt-in screen sharing. */
class HubMindAgentForegroundService : Service() {
    companion object {
        private const val CHANNEL_ID = "hubmind_agent_session_channel"
        private const val NOTIFICATION_ID = 2844
        private const val ACTION_START_SCREEN_CAPTURE = "com.example.hubmind.action.START_SCREEN_CAPTURE"
        private const val ACTION_STOP_SCREEN_CAPTURE = "com.example.hubmind.action.STOP_SCREEN_CAPTURE"
        private const val ACTION_SET_JESS_MICROPHONE = "com.example.hubmind.action.SET_JESS_MICROPHONE"
        private const val EXTRA_JESS_MICROPHONE_ACTIVE = "jessMicrophoneActive"
        private const val EXTRA_CAPTURE_RESULT_CODE = "captureResultCode"
        private const val EXTRA_CAPTURE_RESULT_DATA = "captureResultData"

        @Volatile
        private var activeInstance: HubMindAgentForegroundService? = null

        fun startService(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, HubMindAgentForegroundService::class.java))
        }

        fun stopService(context: Context) {
            context.stopService(Intent(context, HubMindAgentForegroundService::class.java))
        }

        fun startScreenCapture(context: Context, resultCode: Int, resultData: Intent) {
            val intent = Intent(context, HubMindAgentForegroundService::class.java).apply {
                action = ACTION_START_SCREEN_CAPTURE
                putExtra(EXTRA_CAPTURE_RESULT_CODE, resultCode)
                putExtra(EXTRA_CAPTURE_RESULT_DATA, resultData)
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun stopScreenCapture(context: Context) {
            val intent = Intent(context, HubMindAgentForegroundService::class.java).apply {
                action = ACTION_STOP_SCREEN_CAPTURE
            }
            context.startService(intent)
        }

        fun setJessMicrophoneActive(context: Context, active: Boolean) {
            val intent = Intent(context, HubMindAgentForegroundService::class.java).apply {
                action = ACTION_SET_JESS_MICROPHONE
                putExtra(EXTRA_JESS_MICROPHONE_ACTIVE, active)
            }
            if (active) ContextCompat.startForegroundService(context, intent)
            else runCatching { context.startService(intent) }
        }

        /** Update the native overlay from the real workspace Live state without IPC per audio frame. */
        fun updateJessOverlayState(
            context: Context,
            state: String,
            inputLevel: Float,
            outputLevel: Float,
            connected: Boolean
        ) {
            activeInstance?.jessOrbOverlayManager?.update(state, inputLevel, outputLevel, connected)
                ?: run {
                    if (Settings.canDrawOverlays(context)) {
                        ContextCompat.startForegroundService(
                            context,
                            Intent(context, HubMindAgentForegroundService::class.java)
                        )
                    }
                }
        }

        fun refreshJessOverlay(context: Context) {
            if (Settings.canDrawOverlays(context)) startService(context)
        }
    }

    private lateinit var screenCaptureManager: AndroidScreenCaptureManager
    lateinit var jessOrbOverlayManager: JessOrbOverlayManager
        private set
    private var jessMicrophoneActive = false

    override fun onCreate() {
        super.onCreate()
        activeInstance = this
        createNotificationChannel()
        screenCaptureManager = AndroidScreenCaptureManager(applicationContext)
        jessOrbOverlayManager = JessOrbOverlayManager(applicationContext)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_SET_JESS_MICROPHONE) {
            val requested = intent.getBooleanExtra(EXTRA_JESS_MICROPHONE_ACTIVE, false)
            val hasPermission = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            jessMicrophoneActive = requested && hasPermission
            if (requested && !hasPermission) {
                AndroidScreenShareEvents.emit(
                    AndroidScreenShareEvent(
                        "microphone-error",
                        error = "Grant microphone permission before starting a background Jess voice session."
                    )
                )
            }
        }

        val captureRequested = intent?.action == ACTION_START_SCREEN_CAPTURE || screenCaptureManager.isCaptureActive
        startAgentForeground(captureRequested, jessMicrophoneActive)
        // The orb is persistent while this foreground agent is enabled, including
        // when Jess is idle, so it can be tapped to start the shared Live session.
        jessOrbOverlayManager.show()

        when (intent?.action) {
            ACTION_START_SCREEN_CAPTURE -> {
                val resultCode = intent.getIntExtra(EXTRA_CAPTURE_RESULT_CODE, Activity.RESULT_CANCELED)
                @Suppress("DEPRECATION")
                val resultData = intent.getParcelableExtra<Intent>(EXTRA_CAPTURE_RESULT_DATA)
                if (resultCode == Activity.RESULT_OK && resultData != null) {
                    screenCaptureManager.start(resultCode, resultData)
                    updateNotification()
                } else {
                    AndroidScreenShareEvents.emit(AndroidScreenShareEvent("error", error = "Android screen capture permission was not granted."))
                }
            }
            ACTION_STOP_SCREEN_CAPTURE -> {
                screenCaptureManager.stopCapture()
                startAgentForeground(includeMediaProjection = false, includeMicrophone = jessMicrophoneActive)
                updateNotification()
            }
        }
        return START_STICKY
    }

    private fun startAgentForeground(includeMediaProjection: Boolean, includeMicrophone: Boolean) {
        var types = 0
        if (Build.VERSION.SDK_INT >= 34) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && includeMediaProjection) {
            types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && includeMicrophone) {
            types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && types != 0) {
            startForeground(NOTIFICATION_ID, buildNotification(), types)
        } else {
            startForeground(NOTIFICATION_ID, buildNotification())
        }
    }

    private fun buildNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val content = when {
            screenCaptureManager.isCaptureActive && jessMicrophoneActive -> "Jess voice and screen sharing are active."
            screenCaptureManager.isCaptureActive -> "Jess is receiving screen frames."
            jessMicrophoneActive -> "Jess voice is active in the background."
            else -> "Your phone is available for commands you explicitly request."
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Hub-Mind Android Agent Active")
            .setContentText(content)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build()
    }

    private fun updateNotification() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification())
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        jessOrbOverlayManager.close()
        screenCaptureManager.stopCapture()
        if (activeInstance === this) activeInstance = null
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Hub-Mind Android Device Agent",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Visible foreground session for owner-authorized device commands and screen sharing."
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }
}
