package com.example.hubmind.agent

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Process
import java.util.Calendar
import java.util.concurrent.TimeUnit

data class AndroidAppUsageRecord(
    val packageName: String,
    val appName: String,
    val foregroundMinutes: Long,
    val lastUsedAt: Long
)

data class AndroidAppUsageResult(
    val success: Boolean,
    val usageAccessGranted: Boolean,
    val days: Int,
    val records: List<AndroidAppUsageRecord> = emptyList(),
    val error: String? = null
)

/**
 * Reads Android's aggregated UsageStats API only after the device owner has
 * explicitly granted Usage Access in system settings. It cannot read private
 * app data, notification contents, messages, or unrestricted OS event logs.
 */
class AndroidUsageStatsReader(private val context: Context) {
    fun hasUsageAccess(): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager
            ?: return false
        return runCatching {
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            ) == AppOpsManager.MODE_ALLOWED
        }.getOrDefault(false)
    }

    fun readRecentUsage(days: Int = 7, limit: Int = 15): AndroidAppUsageResult {
        val safeDays = days.coerceIn(1, 30)
        if (!hasUsageAccess()) {
            return AndroidAppUsageResult(
                success = false,
                usageAccessGranted = false,
                days = safeDays,
                error = "Usage Access has not been granted. Open Android Settings > Apps > Special app access > Usage access > Hub-Mind, then enable Allow usage access. This permission is optional and is not enabled automatically."
            )
        }

        val usageManager = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return AndroidAppUsageResult(false, true, safeDays, error = "Android UsageStatsManager is unavailable on this device.")

        val endAt = System.currentTimeMillis()
        val startCalendar = Calendar.getInstance().apply {
            timeInMillis = endAt
            add(Calendar.DAY_OF_YEAR, -safeDays)
        }
        val raw = runCatching {
            usageManager.queryUsageStats(
                UsageStatsManager.INTERVAL_DAILY,
                startCalendar.timeInMillis,
                endAt
            ).orEmpty()
        }.getOrElse { error ->
            return AndroidAppUsageResult(
                success = false,
                usageAccessGranted = true,
                days = safeDays,
                error = error.message ?: "Android could not read app usage statistics."
            )
        }

        val grouped = raw
            .filter { it.packageName.isNotBlank() && it.totalTimeInForeground > 0L }
            .groupBy { it.packageName }
            .map { (packageName, entries) ->
                val minutes = TimeUnit.MILLISECONDS.toMinutes(entries.sumOf { it.totalTimeInForeground })
                val lastUsed = entries.maxOfOrNull { it.lastTimeUsed } ?: 0L
                val appName = runCatching {
                    val appInfo = context.packageManager.getApplicationInfo(packageName, 0)
                    context.packageManager.getApplicationLabel(appInfo).toString()
                }.getOrDefault(packageName)
                AndroidAppUsageRecord(
                    packageName = packageName,
                    appName = appName,
                    foregroundMinutes = minutes,
                    lastUsedAt = lastUsed
                )
            }
            .filter { it.foregroundMinutes > 0L }
            .sortedByDescending { it.foregroundMinutes }
            .take(limit.coerceIn(1, 30))

        return AndroidAppUsageResult(
            success = true,
            usageAccessGranted = true,
            days = safeDays,
            records = grouped
        )
    }
}
