package com.example.hubmind.data.remote

/**
 * Transfers the short-lived Google ID token from native Google Sign-In to the
 * trusted Hub-Mind Web workspace inside the app's embedded WebView.
 *
 * The token is held only in memory and is consumed once. It is never written
 * to preferences, logs, files, or Firestore.
 */
object NativeWebAuthTokenHolder {
    private val lock = Any()
    private var pendingGoogleIdToken: String? = null

    fun store(token: String) {
        if (token.isBlank()) return
        synchronized(lock) {
            pendingGoogleIdToken = token
        }
    }

    fun consume(): String {
        return synchronized(lock) {
            val token = pendingGoogleIdToken.orEmpty()
            pendingGoogleIdToken = null
            token
        }
    }
}
