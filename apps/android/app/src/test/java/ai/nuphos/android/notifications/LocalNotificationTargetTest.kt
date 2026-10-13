package ai.nuphos.android.notifications

import org.junit.Assert.*
import org.junit.Test

class LocalNotificationTargetTest {
    private val target = LocalNotificationTarget("account", "team", "session")
    @Test fun malformedTargetsAreRejected() {
        for (bad in listOf("", "../other", "space here", "x".repeat(129))) {
            assertNull(LocalNotificationTarget.from(bad, "team", "session"))
            assertNull(LocalNotificationTarget.from("account", bad, "session"))
            assertNull(LocalNotificationTarget.from("account", "team", bad))
        }
        assertEquals(target, LocalNotificationTarget.from("account", "team", "session"))
    }
    @Test fun matchingTargetIsConsumedOnce() {
        val pending = PendingLocalNotification()
        pending.offer(target)
        assertEquals(target, pending.take("account", "team", true))
        assertNull(pending.take("account", "team", true))
    }
    @Test fun wrongAccountOrTeamCannotNavigate() {
        val pending = PendingLocalNotification()
        pending.offer(target)
        assertNull(pending.take("other", "team", true))
        assertNull(pending.value.value)
        pending.offer(target)
        assertNull(pending.take("account", "other", true))
        assertNull(pending.value.value)
    }
    @Test fun waitForIdentityAndTeamButNeverBypassConsent() {
        val pending = PendingLocalNotification()
        pending.offer(target)
        assertNull(pending.take(null, null, false))
        assertEquals(target, pending.value.value)
        assertNull(pending.take("account", "team", false))
        assertNull(pending.value.value)
    }
    @Test fun explicitClearRemovesPendingTarget() {
        val pending = PendingLocalNotification()
        pending.offer(target); pending.clear()
        assertNull(pending.value.value)
    }
}
