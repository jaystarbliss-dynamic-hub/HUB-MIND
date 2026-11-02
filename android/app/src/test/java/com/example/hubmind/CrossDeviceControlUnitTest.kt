package com.example.hubmind

import com.example.hubmind.data.model.DeviceNode
import com.example.hubmind.data.model.DevicePlatform
import com.example.hubmind.data.model.DeviceStatus
import com.example.hubmind.data.transport.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class CrossDeviceControlUnitTest {

    @Test
    fun testCommandEnvelopeLifecycle() {
        val envelope = CommandEnvelope(
            issuingUserId = "usr-01",
            sourceDeviceId = "android-01",
            targetDeviceId = "win-01",
            actionType = "launch_windows_application",
            parameters = mapOf("appName" to "calc.exe")
        )

        assertEquals("1.0", envelope.protocolVersion)
        assertEquals(CommandLifecycle.CREATED, envelope.lifecycleState)
        assertTrue(envelope.expirationTime > System.currentTimeMillis())
        assertTrue(envelope.replayToken.startsWith("nonce-"))
    }

    @Test
    fun testDeviceResolverQueries() {
        val android = DeviceNode("android-01", "Hub-Mind Phone", DevicePlatform.ANDROID, "2.4.0", DeviceStatus.ONLINE)
        val win = DeviceNode("win-01", "ThinkPad P1", DevicePlatform.WINDOWS, "2.4.0", DeviceStatus.ONLINE)
        val devices = listOf(android, win)

        val phoneMatch = JessDeviceResolver.resolveDeviceQuery("open Settings on my phone", devices)
        assertNotNull(phoneMatch)
        assertEquals("android-01", phoneMatch?.deviceId)

        val pcMatch = JessDeviceResolver.resolveDeviceQuery("open document on my laptop", devices)
        assertNotNull(pcMatch)
        assertEquals("win-01", pcMatch?.deviceId)
    }

    @Test
    fun testControlPlaneTransportDispatchAndAntiReplay() = runBlocking {
        val transport = HubMindControlPlaneTransportImpl()
        transport.connect("usr-01", "android-01")

        val envelope = CommandEnvelope(
            issuingUserId = "usr-01",
            sourceDeviceId = "android-01",
            targetDeviceId = "win-01",
            actionType = "take_windows_screenshot",
            replayToken = "nonce-unique-1001"
        )

        val result = transport.dispatchCommand(envelope)
        assertTrue(result.success)
        assertTrue(result.verified)

        // Re-sending the exact same replayToken must be rejected
        val replayAttempt = transport.dispatchCommand(envelope)
        assertFalse(replayAttempt.success)
        assertTrue(replayAttempt.error?.contains("replayToken", ignoreCase = true) == true)
    }

    @Test
    fun testExpiredCommandEnvelopeRejected() = runBlocking {
        val transport = HubMindControlPlaneTransportImpl()
        val expiredEnvelope = CommandEnvelope(
            issuingUserId = "usr-01",
            sourceDeviceId = "android-01",
            targetDeviceId = "win-01",
            actionType = "launch_windows_application",
            expirationTime = System.currentTimeMillis() - 5000L
        )
        val res = transport.dispatchCommand(expiredEnvelope)
        assertFalse(res.success)
        assertFalse(res.verified)
    }
}
