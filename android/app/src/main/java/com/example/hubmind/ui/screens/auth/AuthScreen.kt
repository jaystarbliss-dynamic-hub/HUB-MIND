package com.example.hubmind.ui.screens.auth

import android.app.Activity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Hub
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.hubmind.di.ServiceLocator
import com.example.hubmind.ui.theme.*
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import kotlinx.coroutines.launch

@Composable
fun AuthScreen(
    viewModel: AuthViewModel,
    onAuthSuccess: () -> Unit,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    LaunchedEffect(state.user, state.isLoading) {
        if (state.user != null && !state.isLoading) onAuthSuccess()
    }

    val googleSignInLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            try {
                val account = GoogleSignIn.getSignedInAccountFromIntent(result.data)
                    .getResult(ApiException::class.java)
                val idToken = account?.idToken
                if (!idToken.isNullOrBlank()) {
                    viewModel.signInWithGoogleIdToken(idToken)
                } else {
                    viewModel.onGoogleSignInError(
                        "Google Sign-In did not return an ID token. Verify the registered Android certificate and Firebase Google provider."
                    )
                }
            } catch (e: ApiException) {
                viewModel.onGoogleSignInError(
                    "Google Sign-In failed (code ${e.statusCode}): ${e.statusMessage ?: e.message ?: "Unknown Google authentication error"}."
                )
            }
        } else if (result.resultCode == Activity.RESULT_CANCELED) {
            viewModel.onGoogleSignInError("Google Sign-In was cancelled. Tap Continue with Google to try again.")
        } else {
            viewModel.onGoogleSignInError(
                "Google Sign-In did not complete (activity result ${result.resultCode}). Check the Android OAuth configuration and try again."
            )
        }
    }

    Box(
        modifier = modifier.fillMaxSize().background(Slate950)
            .statusBarsPadding().navigationBarsPadding().padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().widthIn(max = 480.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            Box(
                modifier = Modifier.size(64.dp).clip(RoundedCornerShape(16.dp))
                    .background(Slate900)
                    .border(1.5.dp, Teal500.copy(alpha = 0.6f), RoundedCornerShape(16.dp)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Filled.Hub,
                    contentDescription = "Hub-Mind Logo",
                    tint = Teal400,
                    modifier = Modifier.size(36.dp)
                )
            }

            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    "Hub-Mind",
                    style = MaterialTheme.typography.headlineLarge,
                    fontWeight = FontWeight.Bold,
                    color = Slate50
                )
                Text(
                    "Personal Operating Assistant & Studio Portal",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Slate400,
                    textAlign = TextAlign.Center
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            state.errorMessage?.let { error ->
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    color = Rose400.copy(alpha = 0.12f),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Rose400.copy(alpha = 0.4f))
                ) {
                    Text(
                        error,
                        style = MaterialTheme.typography.bodySmall,
                        color = Rose400,
                        modifier = Modifier.padding(12.dp)
                    )
                }
            }

            OutlinedButton(
                onClick = {
                    scope.launch {
                        ServiceLocator.backendClient.fetchAndValidateRuntimeConfig().fold(
                            onSuccess = { cfg ->
                                val webClientId = cfg.firebaseGoogleClientId
                                if (webClientId.isBlank()) {
                                    viewModel.onGoogleSignInError(
                                        "Firebase Google OAuth Web Client ID is missing from /api/config."
                                    )
                                } else {
                                    val options = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                                        .requestEmail()
                                        .requestIdToken(webClientId)
                                        .build()
                                    googleSignInLauncher.launch(
                                        GoogleSignIn.getClient(context, options).signInIntent
                                    )
                                }
                            },
                            onFailure = { error ->
                                viewModel.onGoogleSignInError(
                                    error.message ?: "Could not load Hub-Mind Firebase configuration."
                                )
                            }
                        )
                    }
                },
                enabled = !state.isLoading,
                modifier = Modifier.fillMaxWidth().height(52.dp).testTag("google_sign_in_button"),
                shape = RoundedCornerShape(12.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, Slate700),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Slate200)
            ) {
                if (state.isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = Teal400,
                        strokeWidth = 2.dp
                    )
                } else {
                    Text("Continue with Google", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                }
            }

            Text(
                "Sign in securely with your authorized Google account.",
                style = MaterialTheme.typography.bodySmall,
                color = Slate400,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                "Private native build for Jaystarbliss Studios. Connects to canonical Firestore collections and Windows desktop device agent.",
                style = MaterialTheme.typography.labelSmall,
                color = Slate500,
                textAlign = TextAlign.Center,
                fontSize = 11.sp
            )
        }
    }
}
