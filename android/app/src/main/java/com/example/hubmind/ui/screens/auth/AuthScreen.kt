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
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Hub
import androidx.compose.material.icons.filled.Lock
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
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
        if (state.user != null && !state.isLoading) {
            onAuthSuccess()
        }
    }

    val googleSignInLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val task = GoogleSignIn.getSignedInAccountFromIntent(result.data)
            try {
                val account = task.getResult(ApiException::class.java)
                val idToken = account?.idToken
                if (!idToken.isNullOrBlank()) {
                    viewModel.signInWithGoogleIdToken(idToken)
                } else {
                    viewModel.onGoogleSignInError("Google Sign-In did not return an ID token. Verify the Android SHA-1 certificate is registered in Firebase.")
                }
            } catch (e: ApiException) {
                viewModel.onGoogleSignInError("Google Sign-In failed (code ${e.statusCode}): ${e.message}")
            }
        } else {
            val diagnostic = result.data?.let { intent ->
                try {
                    GoogleSignIn.getSignedInAccountFromIntent(intent).getResult(ApiException::class.java)
                    "Google Sign-In did not complete (activity result " + result.resultCode + ")."
                } catch (e: ApiException) {
                    "Google Sign-In failed (status " + e.statusCode + "): " + (e.statusMessage ?: e.message ?: "Unknown Google authentication error") + "."
                }
            } ?: if (result.resultCode == Activity.RESULT_CANCELED) {
                "Google Sign-In was cancelled. If you did not cancel it, verify the Android SHA-1/SHA-256 fingerprints and Web OAuth client ID in Firebase."
            } else {
                "Google Sign-In did not complete (activity result " + result.resultCode + "). Verify the Android OAuth client configuration."
            }
            viewModel.onGoogleSignInError(diagnostic + " You can also sign in with your Hub-Mind email and password.")
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Slate950)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .widthIn(max = 480.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Slate900)
                    .border(1.5.dp, Teal500.copy(alpha = 0.6f), RoundedCornerShape(16.dp)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Filled.Hub,
                    contentDescription = "Hub-Mind Logo",
                    tint = Teal400,
                    modifier = Modifier.size(36.dp)
                )
            }

            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = "Hub-Mind",
                    style = MaterialTheme.typography.headlineLarge,
                    fontWeight = FontWeight.Bold,
                    color = Slate50
                )
                Text(
                    text = "Personal Operating Assistant & Studio Portal",
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
                        text = error,
                        style = MaterialTheme.typography.bodySmall,
                        color = Rose400,
                        modifier = Modifier.padding(12.dp)
                    )
                }
            }

            OutlinedTextField(
                value = state.email,
                onValueChange = viewModel::onEmailChange,
                label = { Text("Studio Email", color = Slate400) },
                leadingIcon = { Icon(Icons.Filled.Email, contentDescription = null, tint = Slate400) },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("email_input"),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Teal400,
                    unfocusedBorderColor = Slate700,
                    focusedTextColor = Slate50,
                    unfocusedTextColor = Slate200,
                    focusedContainerColor = Slate900,
                    unfocusedContainerColor = Slate900
                )
            )

            OutlinedTextField(
                value = state.password,
                onValueChange = viewModel::onPasswordChange,
                label = { Text("Password", color = Slate400) },
                leadingIcon = { Icon(Icons.Filled.Lock, contentDescription = null, tint = Slate400) },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("password_input"),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Teal400,
                    unfocusedBorderColor = Slate700,
                    focusedTextColor = Slate50,
                    unfocusedTextColor = Slate200,
                    focusedContainerColor = Slate900,
                    unfocusedContainerColor = Slate900
                )
            )

            Button(
                onClick = viewModel::signIn,
                enabled = !state.isLoading && state.email.isNotBlank() && state.password.isNotBlank(),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp)
                    .testTag("sign_in_button"),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Teal500,
                    contentColor = Slate950
                )
            ) {
                if (state.isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(22.dp),
                        color = Slate950,
                        strokeWidth = 2.dp
                    )
                } else {
                    Text("Sign In to Hub-Mind", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                }
            }

            OutlinedButton(
                onClick = {
                    scope.launch {
                        val cfgRes = ServiceLocator.backendClient.fetchAndValidateRuntimeConfig()
                        cfgRes.fold(
                            onSuccess = { cfg ->
                                if (cfg.googleClientId.isBlank()) {
                                    viewModel.onGoogleSignInError(
                                        "Google Web Client ID is not configured on /api/config. Please sign in with your Hub-Mind email and password."
                                    )
                                } else {
                                    val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                                        .requestEmail()
                                        .requestIdToken(cfg.googleClientId)
                                        .build()
                                    val googleClient = GoogleSignIn.getClient(context, gso)
                                    googleSignInLauncher.launch(googleClient.signInIntent)
                                }
                            },
                            onFailure = { err ->
                                viewModel.onGoogleSignInError(
                                    err.message ?: "Could not load runtime configuration from Hub-Mind server."
                                )
                            }
                        )
                    }
                },
                enabled = !state.isLoading,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp)
                    .testTag("google_sign_in_button"),
                shape = RoundedCornerShape(12.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, Slate700),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Slate200)
            ) {
                Text("Continue with Google Workspace", fontWeight = FontWeight.Medium)
            }

            Spacer(modifier = Modifier.height(12.dp))

            Text(
                text = "Private native build for Jaystarbliss Studios. Connects to canonical Firestore collections and Windows desktop device agent.",
                style = MaterialTheme.typography.labelSmall,
                color = Slate500,
                textAlign = TextAlign.Center,
                fontSize = 11.sp
            )
        }
    }
}
