package com.example.hubmind

import com.example.hubmind.data.model.DeviceNode
import com.example.hubmind.data.model.DevicePlatform
import com.example.hubmind.data.model.DeviceStatus
import com.example.hubmind.data.model.JessLiveState
import com.example.hubmind.data.model.MemoryCategory
import com.example.hubmind.data.model.User
import com.example.hubmind.data.model.UserMemory
import com.example.hubmind.data.remote.HubMindBackendClient
import com.example.hubmind.data.updater.AppUpdateManifest
import com.example.hubmind.voice.JessCanonicalConfig
import org.junit.Assert.*
import org.junit.Test

class PrivateReleaseAndVoiceUnitTest {

    @Test
    fun testAppUpdateManifestComparison() {
        val currentCode = 240
        val manifest = AppUpdateManifest(
            versionCode = 250,
            versionName = "2.5.0",
            applicationId = "com.aistudio.hubmind.wzyqkp",
            apkUrl = "https://github.com/jaystarbliss-dynamic-hub/HUB-MIND/releases/download/android-v2.5.0/Hub-Mind-Android-v2.5.0.apk",
            sha256 = "a".repeat(64),
            releaseNotes = "New hands-free features and bug fixes."
        )

        assertTrue(manifest.versionCode > currentCode)
        assertEquals("2.5.0", manifest.versionName)
        assertEquals("com.aistudio.hubmind.wzyqkp", manifest.applicationId)
        assertEquals("a".repeat(64), manifest.sha256)
        assertTrue(manifest.apkUrl.startsWith("https://github.com/"))
    }

    @Test
    fun testJessLiveStateEnumValues() {
        val states = JessLiveState.entries
        assertTrue(states.contains(JessLiveState.IDLE))
        assertTrue(states.contains(JessLiveState.LISTENING))
        assertTrue(states.contains(JessLiveState.THINKING))
        assertTrue(states.contains(JessLiveState.SPEAKING))
        assertTrue(states.contains(JessLiveState.MUTED))
        assertTrue(states.contains(JessLiveState.ERROR))
    }

    @Test
    fun testCanonicalFirebaseProjectAndDatabaseConstants() {
        assertEquals("gen-lang-client-0197530608", HubMindBackendClient.CANONICAL_PROJECT_ID)
        assertEquals(
            "ai-studio-hubmind-4cac2024-c6eb-4208-80cf-928714dfd430",
            HubMindBackendClient.CANONICAL_DATABASE_ID
        )
    }

    @Test
    fun testJessCanonicalPromptAndToolDeclarations() {
        val user = User(
            id = "uid-1",
            email = "johnrufai242@gmail.com",
            displayName = "John Rufai",
            preferredName = "Johnny",
            role = "admin",
            status = "active"
        )
        val memories = listOf(
            UserMemory(
                id = "mem-1",
                userId = "uid-1",
                content = "Prefers concise updates",
                category = MemoryCategory.PREFERENCE,
                key = "communication_style"
            )
        )
        val devices = listOf(
            DeviceNode("android-1", "Pixel 9 Pro", DevicePlatform.ANDROID, "2.4.0", DeviceStatus.ONLINE),
            DeviceNode("win-1", "Studio Workstation", DevicePlatform.WINDOWS, "2.4.0", DeviceStatus.ONLINE)
        )

        val prompt = JessCanonicalConfig.buildSystemInstruction(
            user = user,
            memories = memories,
            devices = devices,
            targetDevice = devices[1]
        )
        assertTrue(prompt.contains("Jaystarbliss"))
        assertTrue(prompt.contains("Johnny"))
        assertTrue(prompt.contains("done_verified"))
        assertTrue(prompt.contains("Studio Workstation"))

        val tools = JessCanonicalConfig.buildToolDeclarations()
        assertEquals(4, tools.length())
    }
}
