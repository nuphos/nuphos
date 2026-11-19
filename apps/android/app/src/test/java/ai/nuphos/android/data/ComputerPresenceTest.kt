package ai.nuphos.android.data

import org.junit.Assert.assertEquals
import org.junit.Test

class ComputerPresenceTest {
    private val offline = RuntimeHost("box", "Catalog Box", false)
    private fun device(id: String = "box", state: String? = "paused", box: Boolean = true) =
        RuntimeDevice(id, "Work Box", false, if (box) RuntimeDevice.Box(state) else null, "offline", null, null, null)

    @Test fun anOfflinePausedBoxIsPausedByItsDeviceLabel() {
        assertEquals(ComputerPresence.Paused("Work Box"), ComputerPresence.of(offline, listOf(device(id = "other", state = null), device())))
    }
    @Test fun aPausedBoxOnAnotherDeviceDoesNotCount() {
        assertEquals(ComputerPresence.Offline, ComputerPresence.of(offline, listOf(device(id = "other"))))
    }
    @Test fun anyOtherOfflineComputerIsOffline() {
        assertEquals(ComputerPresence.Offline, ComputerPresence.of(offline, listOf(device(state = "running"))))
        assertEquals(ComputerPresence.Offline, ComputerPresence.of(offline, listOf(device(state = null))))
        assertEquals(ComputerPresence.Offline, ComputerPresence.of(offline, listOf(device(box = false))))
        assertEquals(ComputerPresence.Offline, ComputerPresence.of(offline, emptyList()))
    }
    @Test fun anOnlineOrUnknownComputerIsOnline() {
        assertEquals(ComputerPresence.Online, ComputerPresence.of(offline.copy(online = true), listOf(device())))
        assertEquals(ComputerPresence.Online, ComputerPresence.of(offline.copy(online = null), listOf(device())))
        assertEquals(ComputerPresence.Online, ComputerPresence.of(null, listOf(device())))
    }
}
