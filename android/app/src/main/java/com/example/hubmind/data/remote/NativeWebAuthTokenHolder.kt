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
    private var storedAtMillis: Long = 0L
    private const val MAX_TOKEN_AGE_MS = 55 * 60 * 1000L

    fun store(token: String) {
        if (token.isBlank()) return
        synchronized(lock) {
            pendingGoogleIdToken = token
            storedAtMillis = System.currentTimeMillis()
        }
    }

    /** Reads the token without destroying it; the web client acknowledges only after Firebase accepts it. */
    fun peek(): String {
        return synchronized(lock) {
            val token = pendingGoogleIdToken.orEmpty()
            val isFresh = token.isNotBlank() &&
                storedAtMillis > 0L &&
                System.currentTimeMillis() - storedAtMillis <= MAX_TOKEN_AGE_MS
            if (!isFresh) {
                pendingGoogleIdToken = null
                storedAtMillis = 0L
                ""
            } else {
                token
            }
        }
    }

    /** Acknowledge successful Firebase sign-in in the web workspace. */
    fun clear() {
        synchronized(lock) {
            pendingGoogleIdToken = null
            storedAtMillis = 0L
        }
    }

    /** Kept for older bundled web clients; new clients use peek + clear-on-success. */
    fun consume(): String {
        val token = peek()
        if (token.isNotBlank()) clear()
        return token
    }
}
