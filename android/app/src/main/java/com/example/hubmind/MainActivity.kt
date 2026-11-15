package com.example.hubmind

import android.Manifest
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ServiceLocator.initialize(applicationContext)
        enableEdgeToEdge()
        requestEssentialRuntimePermissions()

        setContent {
            HubMindTheme {
                val isSessionValid by ServiceLocator.authRepository.isSessionValid.collectAsState()
                val isSessionReady by ServiceLocator.authRepository.isSessionReady.collectAsState()
                var currentTab by remember { mutableStateOf(HubMindNavDestination.WORKSPACE) }

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

    override fun onResume() {
        super.onResume()
        ServiceLocator.permissionStatusRepository.refreshFromSystem()
        // Once the user has explicitly granted Display Over Other Apps, keep
        // the system-wide Jess orb available even after the Activity is minimised.
        if (Settings.canDrawOverlays(this)) {
            HubMindAgentForegroundService.refreshJessOverlay(this)
        }
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
