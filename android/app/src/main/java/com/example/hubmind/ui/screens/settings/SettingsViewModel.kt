package com.example.hubmind.ui.screens.settings

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.hubmind.agent.*
import com.example.hubmind.data.model.User
import com.example.hubmind.data.repository.*
import com.example.hubmind.data.updater.AppUpdateManifest
import com.example.hubmind.data.updater.HubMindUpdateChecker
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

data class SettingsUiState(
    val user: User? = null,
    val permissionMode: String = "allow-routine", // "ask" | "allow-routine" | "allow-everything"
    val fullControlEnabled: Boolean = true,
    val confirmHighRiskSpoken: Boolean = true,
    val memoryEnabled: Boolean = true,
    val contextScannerEnabled: Boolean = true,
    val hasAudioPermission: Boolean = false,
    val hasNotificationPermission: Boolean = false,
    val hasOverlayPermission: Boolean = false,
    val isAccessibilityConnected: Boolean = false,
    val isAdvancedControlAvailable: Boolean = false,
    val isForegroundSessionActive: Boolean = false,
    val batteryPercent: Int = 100,
    val systemVolume: Int = 75,
    val activeLeaseOwner: String? = null,
    val serverBaseUrl: String = "https://hub-mind.netlify.app",
    val testActionResult: String? = null,
    val actionHistory: List<AndroidActionResult> = emptyList(),
    val updateStatusMessage: String? = null,
    val availableUpdate: AppUpdateManifest? = null
)

class SettingsViewModel(
    private val authRepository: AuthRepository,
    private val permissionStatusRepository: PermissionStatusRepository,
    private val androidAgentController: AndroidAgentController,
    private val jessRepository: JessRepository,
    context: Context
) : ViewModel() {

    private val actionExecutor = AndroidUiActionExecutor(context)
    private val advancedProvider: AdvancedDeviceControlProvider = ShizukuDeviceControlProvider()
    private val context = context.applicationContext
    private val updateChecker = HubMindUpdateChecker(this.context)

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        (permissionStatusRepository as? PermissionStatusRepositoryImpl)?.refreshFromSystem()

        viewModelScope.launch {
            authRepository.currentUser.collect { user ->
                _uiState.value = _uiState.value.copy(user = user)
            }
        }

        viewModelScope.launch {
            permissionStatusRepository.hasRecordAudio.collect { audio ->
                _uiState.value = _uiState.value.copy(hasAudioPermission = audio)
            }
        }

        viewModelScope.launch {
            permissionStatusRepository.hasPostNotifications.collect { notif ->
                _uiState.value = _uiState.value.copy(hasNotificationPermission = notif)
            }
        }

        viewModelScope.launch {
            permissionStatusRepository.hasSystemAlertWindow.collect { overlay ->
                _uiState.value = _uiState.value.copy(hasOverlayPermission = overlay)
            }
        }

        viewModelScope.launch {
            permissionStatusRepository.hasAccessibilityService.collect { acc ->
                _uiState.value = _uiState.value.copy(
                    isAccessibilityConnected = HubMindAccessibilityService.isServiceConnected || acc
                )
            }
        }

        viewModelScope.launch {
            jessRepository.activeLeaseClient.collect { lease ->
                _uiState.value = _uiState.value.copy(activeLeaseOwner = lease)
            }
        }

        val bat = androidAgentController.getBatteryLevel()
        val vol = androidAgentController.getSystemAudioVolume()
        _uiState.value = _uiState.value.copy(
            batteryPercent = bat,
            systemVolume = vol,
            isAccessibilityConnected = HubMindAccessibilityService.isServiceConnected,
            isAdvancedControlAvailable = advancedProvider.isAvailable
        )
    }

    fun setPermissionMode(mode: String) {
        _uiState.value = _uiState.value.copy(permissionMode = mode)
    }

    fun toggleFullControl(enabled: Boolean) {
        _uiState.value = _uiState.value.copy(fullControlEnabled = enabled)
    }

    fun toggleSpokenConfirmation(enabled: Boolean) {
        _uiState.value = _uiState.value.copy(confirmHighRiskSpoken = enabled)
    }

    fun toggleMemory(enabled: Boolean) {
        _uiState.value = _uiState.value.copy(memoryEnabled = enabled)
    }

    fun toggleContextScanner(enabled: Boolean) {
        _uiState.value = _uiState.value.copy(contextScannerEnabled = enabled)
    }

    fun openAccessibilitySettings(context: Context) {
        runCatching {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }
    }

    fun openOverlayPermissionSettings(context: Context) {
        runCatching {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:${context.packageName}")
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }
    }

    fun toggleForegroundSession(context: Context) {
        val next = !_uiState.value.isForegroundSessionActive
        if (next) {
            HubMindAgentForegroundService.startService(context)
        } else {
            HubMindAgentForegroundService.stopService(context)
        }
        _uiState.value = _uiState.value.copy(isForegroundSessionActive = next)
    }

    fun executeTestLocalAction(type: AndroidActionType, params: Map<String, Any> = emptyMap()) {
        viewModelScope.launch {
            val cmd = AndroidCommand(
                actionType = type,
                parameters = params
            )
            val result = actionExecutor.executeCommand(cmd)
            _uiState.value = _uiState.value.copy(
                testActionResult = if (result.success) "SUCCESS: ${result.outputText}" else "ERROR: ${result.error}",
                actionHistory = listOf(result) + _uiState.value.actionHistory.take(10)
            )
        }
    }

    fun checkForAppUpdates() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(updateStatusMessage = "Checking https://hub-mind.netlify.app/api/app-version.json ...")
            val manifest = updateChecker.checkForUpdate()
            if (manifest != null) {
                _uiState.value = _uiState.value.copy(
                    availableUpdate = manifest,
                    updateStatusMessage = "Update v${manifest.versionName} (build ${manifest.versionCode}) available: ${manifest.releaseNotes}"
                )
            } else {
                _uiState.value = _uiState.value.copy(
                    availableUpdate = null,
                    updateStatusMessage = "No newer published Android release is available. Current installed build: 240."
                )
            }
        }
    }

    fun downloadAndInstallUpdate(update: AppUpdateManifest) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                updateStatusMessage = "Downloading v${update.versionName} and verifying its SHA-256 checksum..."
            )
            val download = updateChecker.downloadAndVerifyApk(update)
            download.onSuccess { apkFile ->
                if (!updateChecker.canInstallUnknownApps()) {
                    _uiState.value = _uiState.value.copy(
                        updateStatusMessage = "The APK passed checksum verification. Allow Hub-Mind to install updates from this source, then tap Download & Install again."
                    )
                    runCatching { updateChecker.openInstallPermissionSettings() }
                        .onFailure { err ->
                            _uiState.value = _uiState.value.copy(
                                updateStatusMessage = "APK verified, but Android installation permission settings could not be opened: ${err.message}"
                            )
                        }
                } else {
                    runCatching { updateChecker.promptPackageInstall(apkFile) }
                        .onSuccess {
                            _uiState.value = _uiState.value.copy(
                                updateStatusMessage = "APK checksum verified. Android's package installer has been opened."
                            )
                        }
                        .onFailure { err ->
                            _uiState.value = _uiState.value.copy(
                                updateStatusMessage = "APK verified, but Android could not open the installer: ${err.message}"
                            )
                        }
                }
            }.onFailure { err ->
                _uiState.value = _uiState.value.copy(
                    updateStatusMessage = "Update download or verification failed: ${err.message ?: "Unknown error"}"
                )
            }
        }
    }

    fun setVolume(percent: Int) {
        androidAgentController.setSystemAudioVolume(percent)
        _uiState.value = _uiState.value.copy(systemVolume = percent)
    }

    fun claimExclusiveLease() {
        viewModelScope.launch {
            jessRepository.startVoiceSession()
        }
    }

    fun releaseLease() {
        viewModelScope.launch {
            jessRepository.endVoiceSession()
        }
    }

    fun signOut(onSignedOut: () -> Unit) {
        viewModelScope.launch {
            authRepository.signOut()
            onSignedOut()
        }
    }
}
