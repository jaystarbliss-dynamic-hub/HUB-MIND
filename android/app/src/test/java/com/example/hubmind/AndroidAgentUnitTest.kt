package com.example.hubmind

import com.example.hubmind.agent.*
import org.junit.Assert.*
import org.junit.Test

class AndroidAgentUnitTest {

    @Test
    fun testAndroidCommandCreationAndValidation() {
        val cmd = AndroidCommand(
            actionType = AndroidActionType.TAP,
            parameters = mapOf("x" to 300f, "y" to 600f)
        )

        assertNotNull(cmd.commandId)
        assertEquals(AndroidActionType.TAP, cmd.actionType)
        assertEquals(300f, cmd.parameters["x"])
        assertEquals(600f, cmd.parameters["y"])
        assertTrue(cmd.expiryTimestamp > System.currentTimeMillis())
    }

    @Test
    fun testExpiredCommandRejection() {
        val expiredCmd = AndroidCommand(
            actionType = AndroidActionType.GO_HOME,
            expiryTimestamp = System.currentTimeMillis() - 1000
        )

        assertTrue(expiredCmd.expiryTimestamp < System.currentTimeMillis())
    }

    @Test
    fun testNodeBoundsCalculation() {
        val bounds = NodeBounds(left = 100, top = 200, right = 500, bottom = 800)
        assertEquals(300, bounds.centerX)
        assertEquals(500, bounds.centerY)
    }

    @Test
    fun testAppInfoFiltering() {
        val apps = listOf(
            AppInfo("com.android.chrome", "Google Chrome", isSystemApp = true),
            AppInfo("com.visualstudio.code", "Visual Studio Code", isSystemApp = false),
            AppInfo("com.slack", "Slack", isSystemApp = false)
        )

        val found = apps.find { it.appName.contains("Chrome", ignoreCase = true) }
        assertNotNull(found)
        assertEquals("com.android.chrome", found?.packageName)
    }

    @Test
    fun testShizukuProviderAllowlistCheck() {
        val provider = ShizukuDeviceControlProvider()
        assertEquals("Shizuku ADB Provider", provider.providerName)
        assertFalse(provider.isAvailable)
    }

    @Test
    fun testArtemisUiObservationIndexingAndHitTest() {
        val rootTree = UiNodeInfo(
            id = "root",
            className = "android.widget.FrameLayout",
            packageName = "com.aistudio.hubmind.wzyqkp",
            boundsInScreen = NodeBounds(0, 0, 1080, 2400),
            children = listOf(
                UiNodeInfo(
                    id = "card",
                    className = "android.view.ViewGroup",
                    packageName = "com.aistudio.hubmind.wzyqkp",
                    isClickable = true,
                    text = "Outer Card",
                    boundsInScreen = NodeBounds(40, 200, 1040, 800),
                    children = listOf(
                        UiNodeInfo(
                            id = "btn_inner",
                            className = "android.widget.Button",
                            packageName = "com.aistudio.hubmind.wzyqkp",
                            isClickable = true,
                            text = "Confirm Action",
                            boundsInScreen = NodeBounds(100, 300, 400, 420)
                        ),
                        UiNodeInfo(
                            id = "tiny_invisible",
                            className = "android.view.View",
                            packageName = "com.aistudio.hubmind.wzyqkp",
                            isClickable = true,
                            text = "ZeroSize",
                            boundsInScreen = NodeBounds(0, 0, 2, 2)
                        )
                    )
                )
            )
        )

        val indexed = ArtemisUiObservationEngine.extractIndexedElements(
            root = rootTree,
            screenWidth = 1080,
            screenHeight = 2400
        )

        // Tiny element (2x2) is filtered out; Outer Card and Confirm Action remain
        assertEquals(2, indexed.size)
        assertEquals("Outer Card", indexed[0].label)
        assertEquals("Confirm Action", indexed[1].label)

        // Smallest covering area wins at (250, 350) -> "Confirm Action" button
        val hit = ArtemisUiObservationEngine.findElementAtPoint(indexed, 250, 350)
        assertNotNull(hit)
        assertEquals("Confirm Action", hit?.label)

        val summary = ArtemisUiObservationEngine.formatElementIndexSummary(indexed)
        assertTrue(summary.contains("[1] Outer Card"))
        assertTrue(summary.contains("[2] Confirm Action"))
    }
}
