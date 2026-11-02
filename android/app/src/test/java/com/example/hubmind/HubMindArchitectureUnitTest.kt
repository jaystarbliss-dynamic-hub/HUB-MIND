package com.example.hubmind

import com.example.hubmind.data.model.*
import com.example.hubmind.data.repository.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class HubMindArchitectureUnitTest {

    @Test
    fun testAuthRepositoryAdminAndStaffAssignment() = runBlocking {
        val authRepo = AuthRepositoryImpl()
        val adminRes = authRepo.signIn("johnrufai242@gmail.com", "valid-password")
        assertTrue(adminRes.isSuccess)
        val adminUser = adminRes.getOrNull()
        assertNotNull(adminUser)
        assertEquals("admin", adminUser?.role)
        assertEquals("active", adminUser?.status)

        val secondAdminRes = authRepo.signIn("rufaijohnny@gmail.com", "valid-password")
        assertEquals("admin", secondAdminRes.getOrNull()?.role)

        val staffRes = authRepo.signIn("member@jaystarbliss.com", "valid-password")
        assertEquals("staff", staffRes.getOrNull()?.role)
    }

    @Test
    fun testMockGoogleTokenRejected() = runBlocking {
        val authRepo = AuthRepositoryImpl()
        val fakeGoogleRes = authRepo.signInWithGoogle("mock-google-token")
        assertTrue(fakeGoogleRes.isFailure)
    }

    @Test
    fun testDeviceControlExecutionAndHistory() = runBlocking {
        val deviceControl = DeviceControlRepositoryImpl(emptyList())

        val result = deviceControl.executeTool(
            targetDeviceId = "win-main-workstation",
            toolName = "launch_windows_application",
            args = mapOf("appName" to "code.exe")
        )
        assertFalse(result.success)
        assertFalse(result.verified)
        assertTrue(result.error?.contains("requires a signed-in Hub-Mind account", ignoreCase = true) == true)

        val history = deviceControl.commandHistory.value
        assertEquals(1, history.size)
        assertEquals("launch_windows_application", history[0].toolName)
        assertEquals(CommandStatus.FAILED, history[0].status)
    }

    @Test
    fun testConversationPostingAndJessReplying() = runBlocking {
        val convRepo = ConversationRepositoryImpl()
        val currentConv = convRepo.currentConversation.value
        assertNotNull(currentConv)

        val convId = currentConv!!.id
        val userMsg = convRepo.postUserMessage(convId, "Jess, check tasks")
        assertEquals(MessageSender.USER, userMsg.sender)

        val jessMsg = convRepo.appendJessResponse(convId, "Tasks are up to date", null, "done_verified")
        assertEquals(MessageSender.JESS, jessMsg.sender)
        assertEquals("done_verified", jessMsg.executionStatus)

        val messages = convRepo.getMessages(convId).first()
        assertTrue(messages.any { it.id == userMsg.id })
        assertTrue(messages.any { it.id == jessMsg.id })
    }

    @Test
    fun testJessLiveStateTransitions() = runBlocking {
        val convRepo = ConversationRepositoryImpl()
        val deviceControl = DeviceControlRepositoryImpl(emptyList())
        val deviceRegistry = object : DeviceRegistryRepository {
            private val win = DeviceNode("win-01", "PC", DevicePlatform.WINDOWS, "2.4.0", DeviceStatus.ONLINE)
            override val devices = kotlinx.coroutines.flow.MutableStateFlow(listOf(win))
            override val currentTargetDevice = kotlinx.coroutines.flow.MutableStateFlow<DeviceNode?>(win)
            override suspend fun selectTargetDevice(deviceId: String) {}
            override suspend fun registerCurrentDevice(androidNode: DeviceNode) {}
            override suspend fun pingDevice(deviceId: String) = true
            override suspend fun refreshDevices() {}
        }

        val jessRepo = JessRepositoryImpl(convRepo, deviceControl, deviceRegistry)
        assertEquals(JessLiveState.IDLE, jessRepo.liveState.value)

        jessRepo.startVoiceSession()
        assertEquals(JessLiveState.LISTENING, jessRepo.liveState.value)
        assertEquals(LiveConnectionState.CONNECTED, jessRepo.connectionState.value)
        assertEquals("android", jessRepo.activeLeaseClient.value)

        jessRepo.endVoiceSession()
        assertEquals(JessLiveState.IDLE, jessRepo.liveState.value)
    }
}
