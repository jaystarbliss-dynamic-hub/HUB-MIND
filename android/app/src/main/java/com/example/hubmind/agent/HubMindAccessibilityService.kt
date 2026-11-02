package com.example.hubmind.agent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.ByteArrayOutputStream
import kotlin.coroutines.resume

/**
 * Hub-Mind Native Android Accessibility Service.
 * Provides real-time UI hierarchy inspection, ARTEMIS-adapted tree indexing,
 * gesture execution, semantic node clicking, screenshot capture (API 30+), and text injection.
 */
class HubMindAccessibilityService : AccessibilityService() {

    companion object {
        private val _instance = MutableStateFlow<HubMindAccessibilityService?>(null)
        val instance: StateFlow<HubMindAccessibilityService?> = _instance.asStateFlow()

        fun getInstance(): HubMindAccessibilityService? = _instance.value

        val isServiceConnected: Boolean
            get() = _instance.value != null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        _instance.value = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    }

    override fun onInterrupt() {
    }

    override fun onDestroy() {
        super.onDestroy()
        if (_instance.value === this) {
            _instance.value = null
        }
    }

    fun dumpHierarchyTree(): UiNodeInfo? {
        val root = rootInActiveWindow ?: return null
        return buildNodeTree(root, 0)
    }

    private fun buildNodeTree(node: AccessibilityNodeInfo?, depth: Int): UiNodeInfo? {
        if (node == null || depth > 25) return null
        val rect = Rect()
        node.getBoundsInScreen(rect)
        val childrenList = mutableListOf<UiNodeInfo>()
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            buildNodeTree(child, depth + 1)?.let { childrenList.add(it) }
        }
        return UiNodeInfo(
            id = "node_${depth}_${rect.left}_${rect.top}",
            viewIdResourceName = node.viewIdResourceName,
            className = node.className?.toString(),
            packageName = node.packageName?.toString(),
            text = node.text?.toString(),
            contentDescription = node.contentDescription?.toString(),
            isClickable = node.isClickable,
            isEditable = node.isEditable,
            isScrollable = node.isScrollable,
            boundsInScreen = NodeBounds(rect.left, rect.top, rect.right, rect.bottom),
            children = childrenList
        )
    }

    /**
     * Dumps the active window's UI hierarchy into a flat list of serializable [UiNodeSnapshot] items.
     */
    fun dumpActiveHierarchy(): List<UiNodeSnapshot> {
        val root = rootInActiveWindow ?: return emptyList()
        val result = mutableListOf<UiNodeSnapshot>()
        traverseNode(root, 0, result)
        return result
    }

    private fun traverseNode(
        node: AccessibilityNodeInfo?,
        depth: Int,
        list: MutableList<UiNodeSnapshot>
    ) {
        if (node == null || depth > 25) return

        val rect = Rect()
        node.getBoundsInScreen(rect)

        val snapshot = UiNodeSnapshot(
            nodeId = "node_${list.size}",
            className = node.className?.toString() ?: "android.view.View",
            packageName = node.packageName?.toString() ?: "",
            text = node.text?.toString(),
            contentDescription = node.contentDescription?.toString(),
            viewIdResourceName = node.viewIdResourceName,
            bounds = NodeBounds(rect.left, rect.top, rect.right, rect.bottom),
            isClickable = node.isClickable,
            isEditable = node.isEditable,
            isScrollable = node.isScrollable,
            isEnabled = node.isEnabled,
            isChecked = node.isChecked,
            depth = depth
        )
        list.add(snapshot)

        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            if (child != null) {
                traverseNode(child, depth + 1, list)
                @Suppress("DEPRECATION")
                child.recycle()
            }
        }
    }

    /**
     * Finds a node by visible text, contentDescription, or viewIdResourceName and performs
     * a click (or long-click) on it or its nearest clickable parent.
     */
    fun performSemanticNodeAction(
        targetText: String?,
        viewId: String?,
        longClick: Boolean = false
    ): Pair<Boolean, String?> {
        val root = rootInActiveWindow ?: return Pair(false, "No active window root available.")
        val matched = findMatchingNode(root, targetText?.trim(), viewId?.trim())
            ?: return Pair(
                false,
                "Could not find UI element matching ${targetText ?: viewId ?: "criteria"} on screen."
            )

        val label = matched.text?.toString()
            ?: matched.contentDescription?.toString()
            ?: matched.viewIdResourceName
            ?: matched.className?.toString()
            ?: "UI element"

        val action = if (longClick) {
            AccessibilityNodeInfo.ACTION_LONG_CLICK
        } else {
            AccessibilityNodeInfo.ACTION_CLICK
        }

        var current: AccessibilityNodeInfo? = matched
        while (current != null) {
            val canAct = if (longClick) current.isLongClickable else current.isClickable
            if (canAct && current.isEnabled) {
                val ok = current.performAction(action)
                if (ok) return Pair(true, label)
            }
            current = current.parent
        }

        val okDirect = matched.performAction(action)
        return Pair(okDirect, label)
    }

    private fun findMatchingNode(
        node: AccessibilityNodeInfo?,
        targetText: String?,
        viewId: String?
    ): AccessibilityNodeInfo? {
        if (node == null) return null

        if (!viewId.isNullOrBlank() && node.viewIdResourceName?.contains(viewId, ignoreCase = true) == true) {
            return node
        }
        if (!targetText.isNullOrBlank()) {
            val textVal = node.text?.toString() ?: ""
            val descVal = node.contentDescription?.toString() ?: ""
            if (textVal.contains(targetText, ignoreCase = true) || descVal.contains(targetText, ignoreCase = true)) {
                return node
            }
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findMatchingNode(child, targetText, viewId)
            if (found != null) return found
        }
        return null
    }

    /**
     * Dispatches a tap gesture at the given (x, y) coordinates and suspends until completed.
     */
    suspend fun performTapAtAwait(x: Float, y: Float, durationMs: Long = 80L): Boolean =
        suspendCancellableCoroutine { cont ->
            val path = Path().apply { moveTo(x, y) }
            val stroke = GestureDescription.StrokeDescription(path, 0L, durationMs)
            val gesture = GestureDescription.Builder().addStroke(stroke).build()

            val dispatched = dispatchGesture(gesture, object : GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    if (cont.isActive) cont.resume(true)
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    if (cont.isActive) cont.resume(false)
                }
            }, null)

            if (!dispatched && cont.isActive) {
                cont.resume(false)
            }
        }

    /**
     * Dispatches a swipe/scroll gesture from (startX, startY) to (endX, endY) and suspends until completed.
     */
    suspend fun performSwipeAwait(
        startX: Float,
        startY: Float,
        endX: Float,
        endY: Float,
        durationMs: Long = 300L
    ): Boolean = suspendCancellableCoroutine { cont ->
        val path = Path().apply {
            moveTo(startX, startY)
            lineTo(endX, endY)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0L, durationMs)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()

        val dispatched = dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                if (cont.isActive) cont.resume(true)
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                if (cont.isActive) cont.resume(false)
            }
        }, null)

        if (!dispatched && cont.isActive) {
            cont.resume(false)
        }
    }

    /**
     * Captures a real screenshot via AccessibilityService.takeScreenshot on Android 11+ (API 30+).
     */
    suspend fun captureScreenBase64Await(): Pair<Boolean, String?> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return Pair(false, "Accessibility screenshot requires Android 11 (API 30) or higher.")
        }
        return suspendCancellableCoroutine { cont ->
            try {
                takeScreenshot(
                    Display.DEFAULT_DISPLAY,
                    mainExecutor,
                    object : TakeScreenshotCallback {
                        override fun onSuccess(screenshot: ScreenshotResult) {
                            try {
                                val hwBuffer = screenshot.hardwareBuffer
                                val colorSpace = screenshot.colorSpace
                                val hwBitmap = Bitmap.wrapHardwareBuffer(hwBuffer, colorSpace)
                                hwBuffer.close()
                                if (hwBitmap == null) {
                                    if (cont.isActive) cont.resume(Pair(false, "Failed to wrap screenshot hardware buffer."))
                                    return
                                }
                                val softBitmap = hwBitmap.copy(Bitmap.Config.ARGB_8888, false)
                                hwBitmap.recycle()
                                val baos = ByteArrayOutputStream()
                                softBitmap.compress(Bitmap.CompressFormat.JPEG, 72, baos)
                                softBitmap.recycle()
                                val b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
                                if (cont.isActive) cont.resume(Pair(true, b64))
                            } catch (t: Throwable) {
                                if (cont.isActive) cont.resume(Pair(false, t.message ?: "Screenshot encoding failed."))
                            }
                        }

                        override fun onFailure(errorCode: Int) {
                            if (cont.isActive) {
                                cont.resume(Pair(false, "Accessibility takeScreenshot failed with errorCode=$errorCode."))
                            }
                        }
                    }
                )
            } catch (t: Throwable) {
                if (cont.isActive) cont.resume(Pair(false, t.message ?: "Accessibility screenshot exception."))
            }
        }
    }

    /**
     * Enters text into the currently focused editable node or first editable node on screen.
     * Refuses password fields for user security.
     */
    fun enterTextInFocusedNode(text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)

        val targetNode = if (focused != null && focused.isEditable) {
            focused
        } else {
            findFirstEditableNode(root)
        } ?: return false

        if (targetNode.isPassword) {
            return false
        }

        val arguments = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        return targetNode.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
    }

    private fun findFirstEditableNode(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.isEditable && node.isEnabled && !node.isPassword) return node

        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            val found = findFirstEditableNode(child)
            if (found != null) return found
        }
        return null
    }
}
