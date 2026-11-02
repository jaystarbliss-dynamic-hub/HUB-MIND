package com.example.hubmind.data.updater

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
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
    val apkUrl: String,
    val releaseNotes: String,
    val minSupportedVersionCode: Int = 1,
    val packageName: String = "",
    val sha256: String = ""
)

class HubMindUpdateChecker(private val context: Context) {

    private val manifestUrl = "https://hub-mind.netlify.app/api/app-version.json"
    private val installedPackageName: String = context.packageName

    private fun installedVersionCode(): Int {
        val info = context.packageManager.getPackageInfo(installedPackageName, 0)
        return PackageInfoCompat.getLongVersionCode(info).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    }

    fun currentVersionLabel(): String {
        val info = context.packageManager.getPackageInfo(installedPackageName, 0)
        val code = PackageInfoCompat.getLongVersionCode(info)
        return "v${info.versionName ?: "unknown"} (build $code)"
    }

    private fun isTrustedApkUrl(raw: String): Boolean {
        return runCatching {
            val uri = Uri.parse(raw)
            if (uri.scheme != "https") return@runCatching false
            val host = uri.host?.lowercase().orEmpty()
            val path = uri.path.orEmpty()
            (host == "hub-mind.netlify.app" && path.startsWith("/downloads/")) ||
                (host == "github.com" && path.startsWith("/jaystarbliss-dynamic-hub/HUB-MIND/releases/download/"))
        }.getOrDefault(false)
    }

    suspend fun checkForUpdate(): AppUpdateManifest? = withContext(Dispatchers.IO) {
        var connection: HttpURLConnection? = null
        try {
            val url = URL(manifestUrl)
            connection = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 8000
                readTimeout = 8000
                requestMethod = "GET"
                instanceFollowRedirects = false
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Cache-Control", "no-cache")
            }

            if (connection.responseCode != HttpURLConnection.HTTP_OK) return@withContext null
            val jsonStr = connection.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(jsonStr)

            // A build/test artifact must never be exposed as a self-update candidate.
            if (json.optString("status").uppercase() != "PUBLISHED") return@withContext null

            val packageName = json.optString("packageName")
            if (packageName != installedPackageName) return@withContext null

            val remoteCode = json.optInt("versionCode", 0)
            val currentCode = installedVersionCode()
            if (remoteCode <= currentCode) return@withContext null

            val apkUrl = json.optString("apkUrl")
            if (!isTrustedApkUrl(apkUrl)) return@withContext null

            val sha256 = json.optString("sha256").lowercase()
            if (!sha256.matches(Regex("^[a-f0-9]{64}$"))) return@withContext null

            val minSupported = json.optInt("minSupportedVersionCode", 1)
            if (minSupported < 1 || minSupported > remoteCode) return@withContext null

            AppUpdateManifest(
                versionCode = remoteCode,
                versionName = json.optString("versionName").ifBlank { "unknown" },
                apkUrl = apkUrl,
                releaseNotes = json.optString("releaseNotes").ifBlank { "Hub-Mind Android update." },
                minSupportedVersionCode = minSupported,
                packageName = packageName,
                sha256 = sha256
            )
        } catch (_: Exception) {
            null
        } finally {
            connection?.disconnect()
        }
    }

    fun verifyDownloadedApk(apkFile: File, manifest: AppUpdateManifest): Boolean {
        return runCatching {
            if (!apkFile.isFile || apkFile.length() <= 0L) return@runCatching false
            val digest = MessageDigest.getInstance("SHA-256")
            val actualHash = apkFile.inputStream().buffered().use { input ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val count = input.read(buffer)
                    if (count <= 0) break
                    digest.update(buffer, 0, count)
                }
                digest.digest().joinToString("") { "%02x".format(it) }
            }
            if (!actualHash.equals(manifest.sha256, ignoreCase = true)) return@runCatching false

            val archiveInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.packageManager.getPackageArchiveInfo(
                    apkFile.absolutePath,
                    PackageManager.PackageInfoFlags.of(0)
                )
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageArchiveInfo(apkFile.absolutePath, 0)
            } ?: return@runCatching false

            val archiveVersion = PackageInfoCompat.getLongVersionCode(archiveInfo)
            archiveInfo.packageName == manifest.packageName &&
                archiveInfo.packageName == installedPackageName &&
                archiveVersion == manifest.versionCode.toLong()
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
