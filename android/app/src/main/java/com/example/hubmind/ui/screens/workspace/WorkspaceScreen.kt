package com.example.hubmind.ui.screens.workspace

import android.Manifest
import android.content.Context
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.example.hubmind.data.remote.NativeWebAuthTokenHolder
import com.example.hubmind.agent.HubMindAgentForegroundService
import com.example.hubmind.agent.HubMindJessNativeEvents
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
fun WorkspaceScreen(
    currentNativeTab: String = "WORKSPACE",
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val currentNativeTabState = rememberUpdatedState(currentNativeTab)
    val androidDeviceBridge = remember(context) { HubMindNativeDeviceBridge(context) }
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
            androidDeviceBridge.attach(this)

            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    // The native Jess tab is a route inside this same React application.
                    // Re-apply the current tab after each page load so a fast first launch
                    // cannot lose the native-tab handoff before React mounts its listener.
                    val tab = currentNativeTabState.value
                    view?.evaluateJavascript(nativeTabDispatchScript(tab), null)
                }

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

    LaunchedEffect(webView, currentNativeTab) {
        // Workspace/Jess navigation is handled by the existing React Router tree,
        // not by creating a second WebView or a second Firebase/Jess runtime.
        webView.post {
            webView.evaluateJavascript(nativeTabDispatchScript(currentNativeTab), null)
        }
    }

    LaunchedEffect(webView) {
        HubMindJessNativeEvents.events.collect { gesture ->
            val eventName = when (gesture) {
                "toggle" -> "hubmind-native-jess-toggle"
                "mute" -> "hubmind-native-jess-mute"
                "stop" -> "hubmind-native-jess-stop"
                else -> return@collect
            }
            val script = "window.dispatchEvent(new CustomEvent('$eventName'));"
            webView.post { webView.evaluateJavascript(script, null) }
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

private fun nativeTabDispatchScript(tab: String): String {
    val safeTab = tab.takeIf { it in setOf("WORKSPACE", "JESS", "DEVICES", "ACTIVITY", "SETTINGS") } ?: "WORKSPACE"
    return "try{localStorage.setItem('hubmind.android.nativeTab','$safeTab');window.dispatchEvent(new CustomEvent('hubmind-android-tab-change',{detail:{tab:'$safeTab'}}));}catch(e){}"
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
private class HubMindNativeDeviceBridge(
    private val context: Context
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var webView: WebView? = null

    fun attach(view: WebView) {
        webView = view
    }

    @JavascriptInterface
    fun getAndroidDeviceId(): String {
        if (!isTrustedWorkspaceOrigin()) return ""
        return runCatching { ServiceLocator.deviceRegistryRepository.localDeviceId }
            .getOrDefault("")
    }

    /** Keep the existing workspace LiveAudioClient visible to Android's foreground-service lifecycle. */
    @JavascriptInterface
    fun setJessMicrophoneActive(active: Boolean) {
        if (!isTrustedWorkspaceOrigin()) return
        HubMindAgentForegroundService.setJessMicrophoneActive(context, active)
    }

    /** Mirror actual Live state into the optional native floating orb. */
    @JavascriptInterface
    fun setJessVisualState(state: String, inputLevel: Float, outputLevel: Float, connected: Boolean) {
        if (!isTrustedWorkspaceOrigin()) return
        val safeState = state.takeIf {
            it in setOf("idle", "listening", "thinking", "speaking", "interrupted", "muted", "error")
        } ?: "idle"
        HubMindAgentForegroundService.updateJessOverlayState(
            context,
            safeState,
            inputLevel.coerceIn(0f, 1f),
            outputLevel.coerceIn(0f, 1f),
            connected
        )
    }

    @JavascriptInterface
    fun onTargetDeviceSelected(deviceId: String) {
        if (!isTrustedWorkspaceOrigin()) return
        val target = deviceId.trim().takeIf { it.isNotBlank() && it.length <= 128 } ?: return
        scope.launch {
            runCatching { ServiceLocator.deviceRegistryRepository.selectTargetDevice(target) }
        }
    }

    private fun isTrustedWorkspaceOrigin(): Boolean {
        val current = webView ?: return false
        val uri = runCatching { Uri.parse(current.url.orEmpty()) }.getOrNull() ?: return false
        return isTrustedWorkspaceUrl(uri)
    }

    fun dispose() {
        webView = null
        scope.cancel()
    }
}
