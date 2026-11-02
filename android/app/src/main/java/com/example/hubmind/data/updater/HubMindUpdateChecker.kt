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

    fun promptPackageInstall(apkFile: File) {
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
