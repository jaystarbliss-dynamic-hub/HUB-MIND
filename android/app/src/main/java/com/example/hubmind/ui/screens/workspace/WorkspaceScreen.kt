package com.example.hubmind.ui.screens.workspace

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.example.hubmind.data.remote.NativeWebAuthTokenHolder
import com.example.hubmind.di.ServiceLocator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

private const val HUB_MIND_WORKSPACE_URL = "https://hub-mind.netlify.app/workspace"
private const val HUB_MIND_WORKSPACE_HOST = "hub-mind.netlify.app"

/**
 * Opens the existing, canonical Hub-Mind workspace inside the Android app.
 * Native Google Sign-In is handed to the Web Firebase client once, through a
 * narrowly scoped JavaScript bridge. No separate web account is created.
 */
@Composable
fun WorkspaceScreen(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val androidDeviceBridge = remember { HubMindNativeDeviceBridge() }
    val webView = remember {
        WebView(context).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.safeBrowsingEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false

            // Jess Live in the normal Workspace uses navigator.mediaDevices.getUserMedia.
            // WebView does not inherit the app's Android RECORD_AUDIO grant automatically:
            // approve audio capture only for the canonical Hub-Mind HTTPS origin.
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    val requestOrigin = runCatching { Uri.parse(request.origin.toString()) }.getOrNull()
                    val trustedOrigin = requestOrigin != null &&
                        requestOrigin.scheme.equals("https", ignoreCase = true) &&
                        requestOrigin.host.equals(HUB_MIND_WORKSPACE_HOST, ignoreCase = true)
                    val requestedResources = request.resources.toSet()
                    val audioOnly = requestedResources.isNotEmpty() &&
                        requestedResources.all { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
                    val hasMicPermission = ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.RECORD_AUDIO
                    ) == PackageManager.PERMISSION_GRANTED

                    if (trustedOrigin && audioOnly && hasMicPermission) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    } else {
                        request.deny()
                    }
                }
            }

            addJavascriptInterface(HubMindAndroidAuthBridge(this), "HubMindAndroid")
            addJavascriptInterface(androidDeviceBridge, "HubMindNative")

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest
                ): Boolean {
                    val destination = request.url
                    if (!isTrustedWorkspaceUrl(destination)) return true

                    // The Android app is a workspace client, never a public-homepage browser.
                    // Any root/home navigation returns to the authenticated workspace route.
                    if (destination.path.isNullOrBlank() || destination.path == "/") {
                        view.loadUrl(HUB_MIND_WORKSPACE_URL)
                        return true
                    }
                    return false
                }

                override fun onReceivedSslError(
                    view: WebView,
                    handler: SslErrorHandler,
                    error: android.net.http.SslError
                ) {
                    // Never let the embedded workspace continue through TLS errors.
                    handler.cancel()
                }
            }

            loadUrl(HUB_MIND_WORKSPACE_URL)
        }
    }

    DisposableEffect(webView, androidDeviceBridge) {
        onDispose {
            webView.stopLoading()
            webView.removeJavascriptInterface("HubMindAndroid")
            webView.removeJavascriptInterface("HubMindNative")
            androidDeviceBridge.dispose()
            webView.destroy()
        }
    }

    AndroidView(
        modifier = modifier,
        factory = { webView },
        update = { }
    )
}

private fun isTrustedWorkspaceUrl(uri: Uri): Boolean {
    return uri.scheme.equals("https", ignoreCase = true) &&
        uri.host.equals(HUB_MIND_WORKSPACE_HOST, ignoreCase = true)
}

private class HubMindAndroidAuthBridge(
    private val webView: WebView
) {
    @JavascriptInterface
    fun isAndroidApp(): Boolean = isTrustedWorkspaceOrigin()

    @JavascriptInterface
    fun getGoogleIdToken(): String {
        if (!isWorkspaceAuthRoute()) return ""
        return NativeWebAuthTokenHolder.peek()
    }

    @JavascriptInterface
    fun completeGoogleSignIn() {
        if (isWorkspaceAuthRoute()) NativeWebAuthTokenHolder.clear()
    }

    // Compatibility for a previously installed v2.5.0 WebView bundle.
    @JavascriptInterface
    fun consumeGoogleIdToken(): String = getGoogleIdToken()

    private fun currentTrustedUrl(): Uri? {
        val currentUrl = runCatching { Uri.parse(webView.url.orEmpty()) }.getOrNull() ?: return null
        return currentUrl.takeIf(::isTrustedWorkspaceUrl)
    }

    private fun isTrustedWorkspaceOrigin(): Boolean = currentTrustedUrl() != null

    private fun isWorkspaceAuthRoute(): Boolean {
        val path = currentTrustedUrl()?.path.orEmpty()
        return path.startsWith("/workspace") || path == "/" || path == "/login"
    }
}


/**
 * Exposes the native phone identity to the normal Workspace Jess assistant.
 * This prevents the embedded WebView from registering itself as a second,
 * unrelated WEB device and lets the web Jess UI keep native target selection
 * in sync with the Android agent.
 */
private class HubMindNativeDeviceBridge : android.webkit.JavascriptInterface {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @android.webkit.JavascriptInterface
    fun getAndroidDeviceId(): String {
        if (!isTrustedWorkspaceOrigin()) return ""
        return runCatching { ServiceLocator.deviceRegistryRepository.localDeviceId }
            .getOrDefault("")
    }

    @android.webkit.JavascriptInterface
    fun onTargetDeviceSelected(deviceId: String) {
        if (!isTrustedWorkspaceOrigin()) return
        val target = deviceId.trim().takeIf { it.isNotBlank() && it.length <= 128 } ?: return
        scope.launch {
            runCatching { ServiceLocator.deviceRegistryRepository.selectTargetDevice(target) }
        }
    }

    private fun isTrustedWorkspaceOrigin(): Boolean {
        // The bridge only exists inside WorkspaceScreen, which pins the WebView
        // to the canonical HTTPS host and blocks external navigation.
        return true
    }

    fun dispose() {
        scope.cancel()
    }
}
