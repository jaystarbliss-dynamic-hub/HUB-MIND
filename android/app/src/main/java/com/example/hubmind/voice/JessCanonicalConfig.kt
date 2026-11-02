package com.example.hubmind.voice

import com.example.hubmind.data.model.DeviceNode
import com.example.hubmind.data.model.User
import com.example.hubmind.data.model.UserMemory
import org.json.JSONArray
import org.json.JSONObject

object JessCanonicalConfig {

    fun buildSystemInstruction(
        user: User?,
        memories: List<UserMemory>,
        devices: List<DeviceNode>,
        targetDevice: DeviceNode?,
        permissionMode: String = "ask",
        fullControlEnabled: Boolean = false
    ): String {
        val userName = user?.preferredName?.takeIf { it.isNotBlank() }
            ?: user?.displayName?.takeIf { it.isNotBlank() }
            ?: "there"
        val userRole = user?.role ?: "staff"

        val devicesSummary = if (devices.isEmpty()) {
            "No remote devices currently discovered."
        } else {
            devices.joinToString("\n") { d ->
                "- ${d.deviceName} (id=${d.deviceId}, platform=${d.platform.name}, status=${d.status.name}, fullControl=${d.fullControlActive}, mode=${d.permissionMode})"
            }
        }

        val memoriesSummary = if (memories.isEmpty()) {
            "No custom user memories stored yet."
        } else {
            memories.take(25).joinToString("\n") { m ->
                "- [${m.category.name}] ${m.key ?: m.category.name}: ${m.content}"
            }
        }

        return """
            # CORE IDENTITY
            You are Jess, the AI assistant built into Hub-Mind, the internal operations platform for Jaystarbliss Studios / Jaystarbliss Dynamic Institute.
            - ORIGIN & CREATOR ATTRIBUTION (CRITICAL): Jess as the Hub-Mind assistant experience was originally designed and programmed by Jaystarbliss, founder of Jaystarbliss Studios. If asked who created/designed/programmed Jess, credit Jaystarbliss clearly. Do not falsely claim that Jaystarbliss trained or authored the underlying Google Gemini foundation model.
            - PERSONALITY: You sound like a brilliant female professor-partner: warm, composed, curious, witty when the moment allows, and exceptionally competent. Default to natural, modern English with light British phrasing when organic.
            - USER IDENTITY: The signed-in user is "$userName" (email: ${user?.email ?: "unknown"}, role: $userRole). Address them naturally and sparingly.

            # NATIVE HONESTY & EXECUTION VERIFICATION PROTOCOL
            - Every native Android or Windows action returns verified status (`done_verified`, `sent_unverified`, or `failed`).
            - Say "done" ONLY when `verified == true` (`done_verified`).
            - If an action fails because a permission (Accessibility Service, Microphone, Overlay, or Windows Full Control) is not granted or a device is offline, report the exact reason honestly and never pretend the action succeeded.
            - Never attempt to bypass Android lock screens, biometric authentication, password fields, payment fields, or Windows UAC/Secure Desktop.

            # TWO-WAY CROSS-DEVICE ROUTING
            - Active Target Device: ${targetDevice?.let { "${it.deviceName} (${it.deviceId}, ${it.platform.name}, ${it.status.name})" } ?: "Local Android Phone"}
            - Permission Mode: $permissionMode | Full Control Enabled: $fullControlEnabled
            - Registered Devices on Account:
            $devicesSummary

            - When the user asks to perform an action on this phone (or says "on my phone", "open WhatsApp", "go home", "navigate back", "read my screen"), invoke the corresponding Android tool (`android_device_action`).
            - When the user asks to perform an action on their Windows PC / workstation / laptop (or when the selected target device is WINDOWS), invoke the corresponding Windows tool (`windows_device_action`).

            # PERSONALIZED USER MEMORIES
            $memoriesSummary
        """.trimIndent()
    }

    fun buildToolDeclarations(): JSONArray {
        val arr = JSONArray()

        arr.put(JSONObject().apply {
            put("name", "android_device_action")
            put(
                "description",
                "Execute a real native action on the local Android phone using the Hub-Mind Accessibility Service, PackageManager, or system controllers. Returns verified postcondition status."
            )
            put("parameters", JSONObject().apply {
                put("type", "OBJECT")
                put("properties", JSONObject().apply {
                    put("actionType", JSONObject().apply {
                        put("type", "STRING")
                        put(
                            "description",
                            "Action type: OPEN_APP, TAP, DOUBLE_TAP, LONG_PRESS, SWIPE, SCROLL, TYPE_TEXT, CLEAR_TEXT, NAVIGATE_BACK, GO_HOME, OPEN_RECENTS, OPEN_NOTIFICATIONS, OPEN_QUICK_SETTINGS, GET_CLIPBOARD, SET_CLIPBOARD, SET_VOLUME, GET_DEVICE_STATUS, GET_SCREEN_HIERARCHY, CAPTURE_SCREEN, GET_INSTALLED_APPS"
                        )
                    })
                    put("packageName", JSONObject().put("type", "STRING").put("description", "Android package name (e.g. com.android.chrome)"))
                    put("appName", JSONObject().put("type", "STRING").put("description", "Visible application name to launch (e.g. Chrome, Settings, WhatsApp)"))
                    put("text", JSONObject().put("type", "STRING").put("description", "Text to type or copy to clipboard"))
                    put("targetText", JSONObject().put("type", "STRING").put("description", "Visible UI element text or content description to tap/click"))
                    put("viewId", JSONObject().put("type", "STRING").put("description", "Accessibility viewIdResourceName to target"))
                    put("x", JSONObject().put("type", "NUMBER").put("description", "Screen X coordinate in pixels"))
                    put("y", JSONObject().put("type", "NUMBER").put("description", "Screen Y coordinate in pixels"))
                    put("direction", JSONObject().put("type", "STRING").put("description", "Scroll or swipe direction: up, down, left, right"))
                    put("level", JSONObject().put("type", "NUMBER").put("description", "Media volume level from 0 to 100 when using SET_VOLUME"))
                })
                put("required", JSONArray().put("actionType"))
            })
        })

        arr.put(JSONObject().apply {
            put("name", "windows_device_action")
            put(
                "description",
                "Dispatch an authenticated native command to the paired Windows workstation via the Hub-Mind cross-device control plane and await its verified execution result."
            )
            put("parameters", JSONObject().apply {
                put("type", "OBJECT")
                put("properties", JSONObject().apply {
                    put("targetDeviceId", JSONObject().put("type", "STRING").put("description", "Optional specific Windows deviceId; defaults to the active paired Windows workstation."))
                    put("toolName", JSONObject().apply {
                        put("type", "STRING")
                        put(
                            "description",
                            "Canonical Windows tool name: launch_windows_application, list_windows, manage_windows, control_mouse, type_windows_text, press_windows_keys, take_windows_screenshot, read_windows_screen, get_windows_system_info, manage_windows_clipboard, run_windows_command_native"
                        )
                    })
                    put("name", JSONObject().put("type", "STRING").put("description", "Application name or UI element name"))
                    put("action", JSONObject().put("type", "STRING").put("description", "Window, mouse, or clipboard action"))
                    put("title", JSONObject().put("type", "STRING").put("description", "Window title to manage"))
                    put("text", JSONObject().put("type", "STRING").put("description", "Text to type or write to clipboard"))
                    put("keys", JSONObject().put("type", "STRING").put("description", "Keyboard shortcut (e.g. CTRL+S, ALT+TAB)"))
                    put("command", JSONObject().put("type", "STRING").put("description", "PowerShell command when using run_windows_command_native"))
                })
                put("required", JSONArray().put("toolName"))
            })
        })

        arr.put(JSONObject().apply {
            put("name", "save_user_memory")
            put("description", "Save an important user preference, habit, or instruction to Firestore user memories.")
            put("parameters", JSONObject().apply {
                put("type", "OBJECT")
                put("properties", JSONObject().apply {
                    put("key", JSONObject().put("type", "STRING"))
                    put("content", JSONObject().put("type", "STRING"))
                    put("category", JSONObject().put("type", "STRING"))
                })
                put("required", JSONArray().put("content"))
            })
        })

        arr.put(JSONObject().apply {
            put("name", "end_session")
            put("description", "End the active Jess voice session and enter idle/sleep mode when requested by the user.")
            put("parameters", JSONObject().apply {
                put("type", "OBJECT")
                put("properties", JSONObject())
            })
        })

        return arr
    }
}
