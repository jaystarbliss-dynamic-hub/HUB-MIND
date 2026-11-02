package com.example.hubmind.agent

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.net.Uri
import android.os.BatteryManager
import kotlinx.coroutines.delay

/**
 * Orchestrates all local Android execution capabilities, incorporates Google ARTEMIS
 * UI element indexing and hit-testing, enforces safety checks, awaits real gesture callbacks,
 * and performs postcondition verification.
 */
class AndroidUiActionExecutor(private val context: Context) {

    private val appLauncher = AndroidAppLauncher(context)
    private val clipboardController = AndroidClipboardController(context)
    private val globalActionController = AndroidGlobalActionController()
    val screenCaptureManager = AndroidScreenCaptureManager(context)

    suspend fun executeCommand(command: AndroidCommand): AndroidActionResult {
        val startTime = System.currentTimeMillis()

        if (System.currentTimeMillis() > command.expiryTimestamp) {
            return AndroidActionResult(
                commandId = command.commandId,
                actionType = command.actionType,
                success = false,
                verified = false,
                error = "Command expired before execution (exceeded TTL)."
            )
        }

        if (command.requiresConfirmation) {
            return AndroidActionResult(
                commandId = command.commandId,
                actionType = command.actionType,
                success = false,
                verified = false,
                error = "This action requires explicit user confirmation. No confirmation was provided, so it was not executed."
            )
        }

        val result: AndroidActionResult = when (command.actionType) {
            AndroidActionType.OPEN_APP, AndroidActionType.LAUNCH_APP -> {
                val pkg = command.parameters["packageName"] as? String
                val appName = (command.parameters["appName"] ?: command.parameters["name"]) as? String
                val resolvedPkg = when {
                    !pkg.isNullOrBlank() -> pkg
                    !appName.isNullOrBlank() -> appLauncher.findAppByName(appName)?.packageName
                    else -> null
                }
                val success = !resolvedPkg.isNullOrBlank() && appLauncher.launchAppByPackage(resolvedPkg)
                if (success) {
                    delay(350)
                }
                val hierarchy = HubMindAccessibilityService.instance.value?.dumpActiveHierarchy()
                val activePkg = hierarchy?.firstOrNull()?.packageName
                val verified = success && (activePkg == null || activePkg.equals(resolvedPkg, ignoreCase = true))
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = success,
                    verified = verified,
                    outputText = if (success) "Launched application ${appName ?: resolvedPkg}." else null,
                    error = if (!success) "Target application (${appName ?: pkg}) not found or could not be launched." else null
                )
            }

            AndroidActionType.OPEN_DEEP_LINK -> {
                val uriStr = (command.parameters["uri"] ?: command.parameters["url"]) as? String ?: ""
                val success = runCatching {
                    if (uriStr.isBlank()) return@runCatching false
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uriStr)).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(intent)
                    true
                }.getOrDefault(false)
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = success,
                    verified = success,
                    outputText = if (success) "Opened URI: $uriStr" else null,
                    error = if (!success) "Failed to resolve intent for URI: $uriStr" else null
                )
            }

            AndroidActionType.TAP -> {
                val service = HubMindAccessibilityService.instance.value
                    ?: return accessibilityUnavailableResult(command)

                val elementIndex = (command.parameters["elementIndex"] as? Number)?.toInt()
                if (elementIndex != null) {
                    val tree = service.dumpHierarchyTree()
                    val indexed = if (tree != null) ArtemisUiObservationEngine.extractIndexedElements(tree) else emptyList()
                    val targetEl = indexed.find { it.index == elementIndex }
                    if (targetEl != null) {
                        val tapOk = service.performTapAtAwait(
                            targetEl.bounds.centerX.toFloat(),
                            targetEl.bounds.centerY.toFloat(),
                            80L
                        )
                        return AndroidActionResult(
                            commandId = command.commandId,
                            actionType = command.actionType,
                            success = tapOk,
                            verified = tapOk,
                            outputText = if (tapOk) "Tapped element [$elementIndex] '${targetEl.label}' at (${targetEl.bounds.centerX}, ${targetEl.bounds.centerY})." else null,
                            error = if (!tapOk) "Gesture cancelled while tapping element [$elementIndex]." else null,
                            durationMs = System.currentTimeMillis() - startTime
                        )
                    }
                }

                val targetText = (command.parameters["targetText"] ?: command.parameters["text"]) as? String
                val viewId = command.parameters["viewId"] as? String
                if (!targetText.isNullOrBlank() || !viewId.isNullOrBlank()) {
                    val (semanticOk, matchedLabel) = service.performSemanticNodeAction(targetText, viewId, longClick = false)
                    if (semanticOk) {
                        return AndroidActionResult(
                            commandId = command.commandId,
                            actionType = command.actionType,
                            success = true,
                            verified = true,
                            outputText = "Clicked UI element '$matchedLabel' via Accessibility node action.",
                            durationMs = System.currentTimeMillis() - startTime
                        )
                    }
                    val node = service.dumpActiveHierarchy().firstOrNull { snap ->
                        (!viewId.isNullOrBlank() && snap.viewIdResourceName?.contains(viewId, ignoreCase = true) == true) ||
                            (!targetText.isNullOrBlank() && (
                                snap.text?.contains(targetText, ignoreCase = true) == true ||
                                    snap.contentDescription?.contains(targetText, ignoreCase = true) == true
                                ))
                    }
                    if (node != null) {
                        val tapOk = service.performTapAtAwait(node.bounds.centerX.toFloat(), node.bounds.centerY.toFloat(), 80L)
                        return AndroidActionResult(
                            commandId = command.commandId,
                            actionType = command.actionType,
                            success = tapOk,
                            verified = tapOk,
                            outputText = if (tapOk) "Tapped center (${node.bounds.centerX}, ${node.bounds.centerY}) of '$targetText'." else null,
                            error = if (!tapOk) "Gesture dispatch cancelled while tapping '$targetText'." else null,
                            durationMs = System.currentTimeMillis() - startTime
                        )
                    }
                    return AndroidActionResult(
                        commandId = command.commandId,
                        actionType = command.actionType,
                        success = false,
                        verified = false,
                        error = "No visible UI element matched '${targetText ?: viewId}'."
                    )
                }

                val x = (command.parameters["x"] as? Number)?.toFloat()
                val y = (command.parameters["y"] as? Number)?.toFloat()
                if (x == null || y == null) {
                    return AndroidActionResult(
                        commandId = command.commandId,
                        actionType = command.actionType,
                        success = false,
                        verified = false,
                        error = "TAP requires targetText, viewId, elementIndex, or numeric x and y coordinates."
                    )
                }
                val tree = service.dumpHierarchyTree()
                val indexed = if (tree != null) ArtemisUiObservationEngine.extractIndexedElements(tree) else emptyList()
                val hitElement = ArtemisUiObservationEngine.findElementAtPoint(indexed, x.toInt(), y.toInt())
                val tapCompleted = service.performTapAtAwait(x, y, 80L)
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = tapCompleted,
                    verified = tapCompleted,
                    outputText = if (tapCompleted) {
                        if (hitElement != null) "Tapped '${hitElement.label}' at ($x, $y)."
                        else "Tapped at coordinates ($x, $y)."
                    } else null,
                    error = if (!tapCompleted) "Tap gesture at ($x, $y) was cancelled or rejected by system." else null
                )
            }

            AndroidActionType.DOUBLE_TAP -> {
                val service = HubMindAccessibilityService.instance.value
                    ?: return accessibilityUnavailableResult(command)

                val x = (command.parameters["x"] as? Number)?.toFloat() ?: 500f
                val y = (command.parameters["y"] as? Number)?.toFloat() ?: 500f
                val firstTap = service.performTapAtAwait(x, y, 60L)
                delay(90)
                val secondTap = if (firstTap) service.performTapAtAwait(x, y, 60L) else false
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = firstTap && secondTap,
                    verified = firstTap && secondTap,
                    outputText = if (firstTap && secondTap) "Double-tapped at ($x, $y)." else null,
                    error = if (!(firstTap && secondTap)) "Double-tap gesture failed or was cancelled." else null
                )
            }

            AndroidActionType.LONG_PRESS -> {
                val service = HubMindAccessibilityService.instance.value
                    ?: return accessibilityUnavailableResult(command)

                val targetText = command.parameters["targetText"] as? String
                val viewId = command.parameters["viewId"] as? String
                if (!targetText.isNullOrBlank() || !viewId.isNullOrBlank()) {
                    val (ok, label) = service.performSemanticNodeAction(targetText, viewId, longClick = true)
                    if (ok) {
                        return AndroidActionResult(
                            commandId = command.commandId,
                            actionType = command.actionType,
                            success = true,
                            verified = true,
                            outputText = "Long-pressed UI element '$label'."
                        )
                    }
                }

                val x = (command.parameters["x"] as? Number)?.toFloat() ?: 500f
                val y = (command.parameters["y"] as? Number)?.toFloat() ?: 500f
                val completed = service.performTapAtAwait(x, y, 650L)
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = completed,
                    verified = completed,
                    outputText = if (completed) "Long-pressed at ($x, $y)." else null,
                    error = if (!completed) "Long-press gesture was cancelled." else null
                )
            }

            AndroidActionType.SWIPE, AndroidActionType.SCROLL -> {
                val service = HubMindAccessibilityService.instance.value
                    ?: return accessibilityUnavailableResult(command)

                val direction = (command.parameters["direction"] as? String)?.lowercase()
                val defaultStartX = 540f
                val defaultStartY = when (direction) {
                    "up" -> 450f
                    "down" -> 1450f
                    else -> 1400f
                }
                val defaultEndX = when (direction) {
                    "left" -> 180f
                    "right" -> 900f
                    else -> 540f
                }
                val defaultEndY = when (direction) {
                    "up" -> 1450f
                    "down" -> 450f
                    else -> 400f
                }

                val startX = (command.parameters["startX"] as? Number)?.toFloat() ?: defaultStartX
                val startY = (command.parameters["startY"] as? Number)?.toFloat() ?: defaultStartY
                val endX = (command.parameters["endX"] as? Number)?.toFloat() ?: defaultEndX
                val endY = (command.parameters["endY"] as? Number)?.toFloat() ?: defaultEndY

                val completed = service.performSwipeAwait(startX, startY, endX, endY, 320L)
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = completed,
                    verified = completed,
                    outputText = if (completed) "Scrolled/swiped from ($startX, $startY) to ($endX, $endY)." else null,
                    error = if (!completed) "Swipe/scroll gesture was cancelled or rejected." else null
                )
            }

            AndroidActionType.TYPE_TEXT -> {
                val service = HubMindAccessibilityService.instance.value
                    ?: return accessibilityUnavailableResult(command)

                val text = command.parameters["text"] as? String ?: ""
                val success = service.enterTextInFocusedNode(text)
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = success,
                    verified = success,
                    outputText = if (success) "Entered text into focused input field." else null,
                    error = if (!success) "No focused non-password editable field found on screen." else null
                )
            }

            AndroidActionType.CLEAR_TEXT -> {
                val service = HubMindAccessibilityService.instance.value
                    ?: return accessibilityUnavailableResult(command)

                val success = service.enterTextInFocusedNode("")
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = success,
                    verified = success,
                    outputText = if (success) "Cleared text in focused input field." else null,
                    error = if (!success) "No focused non-password editable field found on screen." else null
                )
            }

            AndroidActionType.NAVIGATE_BACK -> {
                val success = globalActionController.performBack()
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = success,
                    verified = success,
                    outputText = if (success) "Navigated Back." else null,
                    error = if (!success) "Accessibility Service not connected; enable Hub-Mind in Android Accessibility Settings." else null
                )
            }

            AndroidActionType.GO_HOME -> {
                val success = globalActionController.performHome()
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = success,
                    verified = success,
                    outputText = if (success) "Navigated to Android Home screen." else null,
                    error = if (!success) "Accessibility Service not connected; enable Hub-Mind in Android Accessibility Settings." else null
                )
            }

            AndroidActionType.OPEN_RECENTS -> {
                val success = globalActionController.performRecents()
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = success,
                    verified = success,
                    outputText = if (success) "Opened Recent Apps overview." else null,
                    error = if (!success) "Accessibility Service not connected." else null
                )
            }

            AndroidActionType.OPEN_NOTIFICATIONS -> {
                val success = globalActionController.performNotifications()
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = success,
                    verified = success,
                    outputText = if (success) "Expanded Notification Shade." else null,
                    error = if (!success) "Accessibility Service not connected." else null
                )
            }

            AndroidActionType.OPEN_QUICK_SETTINGS -> {
                val success = globalActionController.performQuickSettings()
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = success,
                    verified = success,
                    outputText = if (success) "Opened Quick Settings panel." else null,
                    error = if (!success) "Accessibility Service not connected." else null
                )
            }

            AndroidActionType.GET_CLIPBOARD, AndroidActionType.CLIPBOARD_READ -> {
                val clip = clipboardController.getClipboardText()
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = clip != null,
                    verified = clip != null,
                    outputText = clip ?: "Clipboard is empty or restricted because Hub-Mind is not in foreground focus.",
                    error = if (clip == null) "Clipboard empty or inaccessible." else null
                )
            }

            AndroidActionType.SET_CLIPBOARD, AndroidActionType.CLIPBOARD_WRITE -> {
                val text = command.parameters["text"] as? String ?: ""
                val success = clipboardController.setClipboardText("HubMind", text)
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = success,
                    verified = success,
                    outputText = if (success) "Copied text to Android clipboard (${text.length} chars)." else null,
                    error = if (!success) "Failed to write to Android clipboard." else null
                )
            }

            AndroidActionType.GET_SCREEN_HIERARCHY -> {
                val service = HubMindAccessibilityService.instance.value
                    ?: return accessibilityUnavailableResult(command)

                val nodes = service.dumpActiveHierarchy()
                val tree = service.dumpHierarchyTree()
                val indexed = if (tree != null) ArtemisUiObservationEngine.extractIndexedElements(tree) else emptyList()
                val summary = ArtemisUiObservationEngine.formatElementIndexSummary(indexed, maxItems = 35)
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = nodes.isNotEmpty(),
                    verified = nodes.isNotEmpty(),
                    hierarchy = tree,
                    uiNodes = nodes,
                    indexedElements = indexed,
                    outputText = if (nodes.isNotEmpty()) {
                        "Active package: ${nodes.firstOrNull()?.packageName ?: "unknown"} (${indexed.size} indexed elements):\n$summary"
                    } else null,
                    error = if (nodes.isEmpty()) "Active window returned 0 accessible UI nodes." else null
                )
            }

            AndroidActionType.CAPTURE_SCREEN -> {
                val service = HubMindAccessibilityService.instance.value
                if (service != null) {
                    val (accSuccess, accBase64OrErr) = service.captureScreenBase64Await()
                    if (accSuccess && !accBase64OrErr.isNullOrBlank()) {
                        return AndroidActionResult(
                            commandId = command.commandId,
                            actionType = command.actionType,
                            success = true,
                            verified = true,
                            screenshotBase64 = accBase64OrErr,
                            outputText = "Captured live Android screen via Accessibility Service (${accBase64OrErr.length} Base64 chars).",
                            durationMs = System.currentTimeMillis() - startTime
                        )
                    }
                }
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = false,
                    verified = false,
                    error = "Screen capture unavailable: enable Hub-Mind Accessibility Service (Android 11+)."
                )
            }

            AndroidActionType.SET_VOLUME -> {
                val level = (command.parameters["level"] as? Number)?.toInt() ?: 70
                val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                val target = ((level.coerceIn(0, 100) / 100f) * max).toInt()
                am.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0)
                val actual = am.getStreamVolume(AudioManager.STREAM_MUSIC)
                val verified = actual == target
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = verified,
                    verified = verified,
                    outputText = "System media volume set to $level% ($actual/$max).",
                    error = if (!verified) "System audio policy prevented changing media volume." else null
                )
            }

            AndroidActionType.GET_DEVICE_STATUS -> {
                val bm = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
                val bat = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
                val accConnected = HubMindAccessibilityService.isServiceConnected
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = true,
                    verified = true,
                    outputText = "Battery: $bat%, AccessibilityConnected: $accConnected"
                )
            }

            AndroidActionType.GET_INSTALLED_APPS -> {
                val apps = appLauncher.getInstalledApplications()
                AndroidActionResult(
                    commandId = command.commandId,
                    actionType = command.actionType,
                    success = true,
                    verified = true,
                    installedApps = apps,
                    outputText = "Found ${apps.size} launchable applications."
                )
            }
        }

        val duration = System.currentTimeMillis() - startTime
        return result.copy(durationMs = duration)
    }

    private fun accessibilityUnavailableResult(command: AndroidCommand): AndroidActionResult {
        return AndroidActionResult(
            commandId = command.commandId,
            actionType = command.actionType,
            success = false,
            verified = false,
            error = "Hub-Mind Accessibility Service is not enabled. Go to Android Settings > Accessibility > Hub-Mind to enable it."
        )
    }
}
