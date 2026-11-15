package com.example.hubmind

import android.Manifest
import android.app.Activity
import android.webkit.WebView
import androidx.lifecycle.lifecycleScope
import com.example.hubmind.data.remote.NativeWebAuthTokenHolder
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import org.json.JSONObject
import kotlinx.coroutines.launch
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.Image
import androidx.compose.material3.Scaffold
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.draw.alpha
import com.example.R
import androidx.compose.ui.Modifier
import com.example.hubmind.di.ServiceLocator
import com.example.hubmind.agent.HubMindAgentForegroundService
import com.example.hubmind.ui.components.HubMindBottomBar
import com.example.hubmind.ui.components.HubMindNavDestination
import com.example.hubmind.ui.screens.activity.ActivityScreen
import com.example.hubmind.ui.screens.activity.ActivityViewModel
import com.example.hubmind.ui.screens.auth.AuthScreen
import com.example.hubmind.ui.screens.auth.AuthViewModel
import com.example.hubmind.ui.screens.devices.DevicesScreen
import com.example.hubmind.ui.screens.devices.DevicesViewModel
import com.example.hubmind.ui.screens.settings.SettingsScreen
import com.example.hubmind.ui.screens.settings.SettingsViewModel
import com.example.hubmind.ui.screens.workspace.WorkspaceScreen
import com.example.hubmind.ui.theme.HubMindTheme
import com.example.hubmind.ui.theme.Slate950

class MainActivity : ComponentActivity() {

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        ServiceLocator.permissionStatusRepository.refreshFromSystem()
    }

    private var pendingWorkspaceWebView: WebView? = null
    private var workspaceGoogleSignInInProgress = false

    // Workspace recovery uses this Activity-owned launcher so a WebView can request
    // the same native Google account picker as the first-run sign-in screen.
    private val workspaceGoogleSignInLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val targetWebView = pendingWorkspaceWebView
        pendingWorkspaceWebView = null
        workspaceGoogleSignInInProgress = false
        if (targetWebView == null) return@registerForActivityResult

        if (result.resultCode != Activity.RESULT_OK || result.data == null) {
            dispatchWorkspaceAuthEvent(
                targetWebView,
                "hubmind-native-token-error",
                "Google account selection was cancelled. Choose an account to continue."
            )
            return@registerForActivityResult
        }

        val idToken = runCatching {
            GoogleSignIn.getSignedInAccountFromIntent(result.data)
                .getResult(ApiException::class.java)
                ?.idToken
                .orEmpty()
        }.getOrElse { error ->
            dispatchWorkspaceAuthEvent(
                targetWebView,
                "hubmind-native-token-error",
                "Google Sign-In failed: ${error.message ?: "Please choose your account again."}"
            )
            return@registerForActivityResult
        }

        if (idToken.isBlank()) {
            dispatchWorkspaceAuthEvent(
                targetWebView,
                "hubmind-native-token-error",
                "Google did not return a secure sign-in token. Verify the Android OAuth configuration."
            )
            return@registerForActivityResult
        }

        lifecycleScope.launch {
            NativeWebAuthTokenHolder.store(idToken)
            ServiceLocator.authRepository.signInWithGoogle(idToken).fold(
                onSuccess = {
                    dispatchWorkspaceAuthEvent(targetWebView, "hubmind-native-token-ready")
                },
                onFailure = { error ->
                    NativeWebAuthTokenHolder.clear()
                    dispatchWorkspaceAuthEvent(
                        targetWebView,
                        "hubmind-native-token-error",
                        error.message ?: "This Google account is not authorized for Hub-Mind."
                    )
                }
            )
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ServiceLocator.initialize(applicationContext)
        enableEdgeToEdge()

        setContent {
            HubMindTheme {
                val isSessionValid by ServiceLocator.authRepository.isSessionValid.collectAsState()
                val isSessionReady by ServiceLocator.authRepository.isSessionReady.collectAsState()
                var currentTab by remember { mutableStateOf(HubMindNavDestination.WORKSPACE) }

                LaunchedEffect(isSessionReady, isSessionValid) {
                    if (!isSessionReady) return@LaunchedEffect
                    if (!isSessionValid) {
                        HubMindAgentForegroundService.stopService(applicationContext)
                    } else {
                        // Keep first launch focused on Google account selection.
                        // Ask for microphone/notification permissions only after auth succeeds.
                        requestEssentialRuntimePermissions()
                    }
                }

                if (!isSessionReady) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        androidx.compose.foundation.layout.Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(18.dp)
                        ) {
                            Image(
                                painter = painterResource(id = R.drawable.hub_mind_logo),
                                contentDescription = "Official Hub-Mind Logo",
                                contentScale = ContentScale.Fit,
                                modifier = Modifier.size(112.dp)
                            )
                            CircularProgressIndicator(color = com.example.hubmind.ui.theme.Teal400)
                            Text("Restoring your Hub-Mind session", color = com.example.hubmind.ui.theme.Slate400)
                        }
                    }
                } else if (!isSessionValid) {
                    val authViewModel = remember {
                        AuthViewModel(ServiceLocator.authRepository)
                    }
                    AuthScreen(
                        viewModel = authViewModel,
                        onAuthSuccess = { }
                    )
                } else {
                    BackHandler(enabled = currentTab != HubMindNavDestination.WORKSPACE) {
                        currentTab = HubMindNavDestination.WORKSPACE
                    }

                    Scaffold(
                        modifier = Modifier.fillMaxSize(),
                        containerColor = Slate950,
                        bottomBar = {
                            HubMindBottomBar(
                                currentDestination = currentTab,
                                onNavigate = { destination ->
                                    currentTab = destination
                                }
                            )
                        }
                    ) { innerPadding ->
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(innerPadding)
                        ) {
                            // Keep one authenticated WebView mounted for the lifetime of the
                            // signed-in shell. Workspace and Jess are two views of the same
                            // React/Firebase session and the same LiveAudioClient.
                            WorkspaceScreen(
                                currentNativeTab = currentTab.name,
                                onRequestGoogleSignIn = ::launchWorkspaceGoogleSignIn,
                                modifier = Modifier
                                    .fillMaxSize()
                                    .alpha(
                                        if (currentTab == HubMindNavDestination.WORKSPACE ||
                                            currentTab == HubMindNavDestination.JESS
                                        ) 1f else 0f
                                    )
                            )

                            when (currentTab) {
                                HubMindNavDestination.JESS,
                                HubMindNavDestination.WORKSPACE -> Unit
                                HubMindNavDestination.DEVICES -> {
                                    val devicesViewModel = remember {
                                        DevicesViewModel(
                                            deviceRegistryRepository = ServiceLocator.deviceRegistryRepository
                                        )
                                    }
                                    DevicesScreen(viewModel = devicesViewModel)
                                }
                                HubMindNavDestination.ACTIVITY -> {
                                    val activityViewModel = remember {
                                        ActivityViewModel(
                                            deviceControlRepository = ServiceLocator.deviceControlRepository
                                        )
                                    }
                                    ActivityScreen(viewModel = activityViewModel)
                                }
                                HubMindNavDestination.SETTINGS -> {
                                    val settingsViewModel = remember {
                                        SettingsViewModel(
                                            authRepository = ServiceLocator.authRepository,
                                            permissionStatusRepository = ServiceLocator.permissionStatusRepository,
                                            androidAgentController = ServiceLocator.androidAgentController,
                                            jessRepository = ServiceLocator.jessRepository,
                                            context = applicationContext
                                        )
                                    }
                                    SettingsScreen(
                                        viewModel = settingsViewModel,
                                        onSignOut = { }
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private fun launchWorkspaceGoogleSignIn(webView: WebView) {
        if (workspaceGoogleSignInInProgress) return
        workspaceGoogleSignInInProgress = true
        pendingWorkspaceWebView = webView

        lifecycleScope.launch {
            val config = ServiceLocator.backendClient.fetchAndValidateRuntimeConfig().getOrElse { error ->
                pendingWorkspaceWebView = null
                workspaceGoogleSignInInProgress = false
                dispatchWorkspaceAuthEvent(
                    webView,
                    "hubmind-native-token-error",
                    error.message ?: "Could not load Hub-Mind Google sign-in configuration."
                )
                return@launch
            }

            val webClientId = config.firebaseGoogleClientId.trim()
            if (webClientId.isBlank()) {
                pendingWorkspaceWebView = null
                workspaceGoogleSignInInProgress = false
                dispatchWorkspaceAuthEvent(
                    webView,
                    "hubmind-native-token-error",
                    "Firebase Google OAuth Web Client ID is missing from /api/config."
                )
                return@launch
            }

            val options = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail()
                .requestIdToken(webClientId)
                .build()

            runCatching {
                workspaceGoogleSignInLauncher.launch(
                    GoogleSignIn.getClient(this@MainActivity, options).signInIntent
                )
            }.onFailure { error ->
                pendingWorkspaceWebView = null
                workspaceGoogleSignInInProgress = false
                dispatchWorkspaceAuthEvent(
                    webView,
                    "hubmind-native-token-error",
                    error.message ?: "Could not open the Google account chooser."
                )
            }
        }
    }

    private fun dispatchWorkspaceAuthEvent(
        webView: WebView,
        eventName: String,
        message: String? = null
    ) {
        if (eventName !in setOf("hubmind-native-token-ready", "hubmind-native-token-error")) return
        val detail = message?.let {
            "{detail:{message:${JSONObject.quote(it.take(500))}}}"
        } ?: "{}"
        val script = "window.dispatchEvent(new CustomEvent('$eventName',$detail));"
        webView.post { webView.evaluateJavascript(script, null) }
    }

    override fun onResume() {
        super.onResume()
        HubMindAgentForegroundService.setHubMindActivityVisible(applicationContext, true)
        ServiceLocator.permissionStatusRepository.refreshFromSystem()
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (ServiceLocator.authRepository.isSessionReady.value &&
            ServiceLocator.authRepository.isSessionValid.value &&
            Settings.canDrawOverlays(this)
        ) {
            // Start the visible overlay while the Activity is still foregrounded,
            // avoiding a restricted background-service start after the app is hidden.
            HubMindAgentForegroundService.setHubMindActivityVisible(applicationContext, false)
        }
    }

    override fun onStop() {
        if (ServiceLocator.authRepository.isSessionReady.value &&
            ServiceLocator.authRepository.isSessionValid.value &&
            Settings.canDrawOverlays(this)
        ) {
            HubMindAgentForegroundService.setHubMindActivityVisible(applicationContext, false)
        } else {
            HubMindAgentForegroundService.setHubMindActivityVisible(applicationContext, true)
        }
        super.onStop()
    }

    private fun requestEssentialRuntimePermissions() {
        val perms = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        runCatching {
            permissionLauncher.launch(perms.toTypedArray())
        }
    }
}
