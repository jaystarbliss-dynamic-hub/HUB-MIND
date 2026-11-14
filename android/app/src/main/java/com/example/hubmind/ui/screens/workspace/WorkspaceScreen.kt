package com.example.hubmind.ui.screens.workspace

import android.net.Uri
import android.webkit.JavascriptInterface
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
import com.example.hubmind.data.remote.NativeWebAuthTokenHolder

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

            addJavascriptInterface(HubMindAndroidAuthBridge(this), "HubMindAndroid")

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest
                ): Boolean {
                    return !isTrustedWorkspaceUrl(request.url)
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

    DisposableEffect(webView) {
        onDispose {
            webView.stopLoading()
            webView.removeJavascriptInterface("HubMindAndroid")
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
    fun consumeGoogleIdToken(): String {
        val currentUrl = runCatching { Uri.parse(webView.url.orEmpty()) }.getOrNull()
            ?: return ""
        if (!isTrustedWorkspaceUrl(currentUrl)) return ""
        return NativeWebAuthTokenHolder.consume()
    }
}
