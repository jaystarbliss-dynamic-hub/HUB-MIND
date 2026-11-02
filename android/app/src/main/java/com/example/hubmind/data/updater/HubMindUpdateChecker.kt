package com.example.hubmind.data.updater

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

data class AppUpdateManifest(
    val versionCode: Int,
    val versionName: String,
    val applicationId: String,
    val apkUrl: String,
    val sha256: String,
    val releaseNotes: String,
    val minSupportedVersionCode: Int = 1
)

class HubMindUpdateChecker(private val context: Context) {

    private val manifestUrl = "https://hub-mind.netlify.app/api/app-version.json"

    private fun installedVersionCode(): Long {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        return PackageInfoCompat.getLongVersionCode(info)
    }

    suspend fun checkForUpdate(): AppUpdateManifest? = withContext(Dispatchers.IO) {
        var connection: HttpURLConnection? = null
        try {
            connection = URL(manifestUrl).openConnection() as HttpURLConnection
            connection.connectTimeout = 8000
            connection.readTimeout = 8000
            connection.requestMethod = "GET"
            connection.setRequestProperty("Cache-Control", "no-cache")
            connection.setRequestProperty("Pragma", "no-cache")

            if (connection.responseCode != HttpURLConnection.HTTP_OK) return@withContext null
            val json = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })

            if (!json.optString("releaseStatus").equals("PUBLISHED", ignoreCase = true)) return@withContext null
            val applicationId = json.optString("applicationId", "").trim()
            if (applicationId != context.packageName) return@withContext null

            val remoteCode = json.optInt("versionCode", 0)
            if (remoteCode <= installedVersionCode()) return@withContext null

            val apkUrl = json.optString("apkUrl", "").trim()
            val parsedApkUrl = runCatching { Uri.parse(apkUrl) }.getOrNull()
            if (parsedApkUrl?.scheme != "https" || parsedApkUrl.host.isNullOrBlank()) return@withContext null

            val checksum = json.optString("sha256", "").trim().lowercase()
            if (!checksum.matches(Regex("^[a-f0-9]{64}$"))) return@withContext null

            AppUpdateManifest(
                versionCode = remoteCode,
                versionName = json.optString("versionName", ""),
                applicationId = applicationId,
                apkUrl = apkUrl,
                sha256 = checksum,
                releaseNotes = json.optString("releaseNotes", "Hub-Mind Android update."),
                minSupportedVersionCode = json.optInt("minSupportedVersionCode", 1)
            )
        } catch (_: Exception) {
            null
        } finally {
            connection?.disconnect()
        }
    }

    fun verifyApkChecksum(apkFile: File, expectedSha256: String): Boolean {
        if (!apkFile.isFile || !expectedSha256.matches(Regex("(?i)^[a-f0-9]{64}$"))) return false
        return runCatching {
            val digest = MessageDigest.getInstance("SHA-256")
            apkFile.inputStream().use { input ->
                val buffer = ByteArray(16 * 1024)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    digest.update(buffer, 0, count)
                }
            }
            val actual = digest.digest().joinToString("") { "%02x".format(it) }
            actual.equals(expectedSha256, ignoreCase = true)
        }.getOrDefault(false)
    }

    suspend fun downloadAndVerifyApk(update: AppUpdateManifest): Result<File> = withContext(Dispatchers.IO) {
        runCatching {
            require(update.applicationId == context.packageName) {
                "This update is for a different Android application."
            }
            val apkUri = Uri.parse(update.apkUrl)
            require(apkUri.scheme.equals("https", ignoreCase = true) && !apkUri.host.isNullOrBlank()) {
                "The update URL is not a valid HTTPS address."
            }
            require(update.sha256.matches(Regex("(?i)^[a-f0-9]{64}$"))) {
                "The release manifest does not contain a valid SHA-256 checksum."
            }

            val updateDirectory = File(context.cacheDir, "updates").apply {
                if (!exists() && !mkdirs()) throw IllegalStateException("Could not create the update cache directory.")
            }
            val safeVersion = update.versionName.replace(Regex("[^A-Za-z0-9._-]"), "_").take(40)
            val apkFile = File(updateDirectory, "hub-mind-$safeVersion.apk")
            var connection: HttpURLConnection? = null
            try {
                connection = URL(update.apkUrl).openConnection() as HttpURLConnection
                connection.connectTimeout = 15_000
                connection.readTimeout = 45_000
                connection.requestMethod = "GET"
                connection.setRequestProperty("Accept", "application/vnd.android.package-archive")
                connection.instanceFollowRedirects = true
                if (connection.responseCode != HttpURLConnection.HTTP_OK) {
                    throw IllegalStateException("APK download failed (HTTP ${connection.responseCode}).")
                }
                val finalUrl = connection.url
                require(finalUrl.protocol.equals("https", ignoreCase = true)) {
                    "The APK download redirected to an insecure URL."
                }
                val contentLength = connection.contentLengthLong
                require(contentLength <= 250L * 1024L * 1024L) {
                    "The APK exceeds the 250 MB update size limit."
                }
                connection.inputStream.use { input ->
                    apkFile.outputStream().use { output ->
                        val buffer = ByteArray(32 * 1024)
                        var total = 0L
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            total += count
                            require(total <= 250L * 1024L * 1024L) {
                                "The APK exceeded the 250 MB update size limit."
                            }
                            output.write(buffer, 0, count)
                        }
                    }
                }
                require(apkFile.length() > 0L && (contentLength <= 0L || apkFile.length() == contentLength)) {
                    "The downloaded APK is incomplete."
                }
            } finally {
                connection?.disconnect()
            }

            if (!verifyApkChecksum(apkFile, update.sha256)) {
                apkFile.delete()
                throw IllegalStateException("APK checksum verification failed. The file was deleted and will not be installed.")
            }
            apkFile
        }
    }

    fun canInstallUnknownApps(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()
    }

    fun openInstallPermissionSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !canInstallUnknownApps()) {
            val intent = Intent(
                android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}")
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }
    }

    fun promptPackageInstall(apkFile: File) {
        require(apkFile.isFile && apkFile.length() > 0L) { "A verified APK file is required for installation." }
        val intent = Intent(Intent.ACTION_VIEW).apply {
            val uri: Uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apkFile)
            } else {
                Uri.fromFile(apkFile)
            }
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }
}
