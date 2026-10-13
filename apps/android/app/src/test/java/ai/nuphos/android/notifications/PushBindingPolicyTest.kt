package ai.nuphos.android.notifications

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PushBindingPolicyTest {
    @Test fun backgroundMessageRequiresCurrentLoginAndMatchingAccount() {
        assertTrue(PushBindingPolicy.accepts("a", "hash-a", "hash-a", "a", false))
        assertFalse(PushBindingPolicy.accepts("a", "hash-a", "hash-b", "a", false))
        assertFalse(PushBindingPolicy.accepts("b", "hash-b", "hash-b", "a", false))
        assertFalse(PushBindingPolicy.accepts("a", "hash-a", null, "a", false))
    }
    @Test fun readingAndClearedBindingSuppressDisplay() {
        assertFalse(PushBindingPolicy.accepts("a", "hash-a", "hash-a", "a", true))
        assertFalse(PushBindingPolicy.accepts(null, null, "hash-a", "a", false))
        assertFalse(PushBindingPolicy.accepts("a", "", "", "a", false))
    }
    @Test fun onlyTheVisibleConversationInTheForegroundIsSuppressed() {
        val target = LocalNotificationTarget("a", "team", "session")
        assertTrue(PushBindingPolicy.isReading(true, target, target))
        assertFalse(PushBindingPolicy.isReading(false, target, target))
        assertFalse(PushBindingPolicy.isReading(true, null, target))
        assertFalse(PushBindingPolicy.isReading(true, target.copy(sessionId = "other"), target))
        assertFalse(PushBindingPolicy.isReading(true, target.copy(teamId = "other"), target))
        assertFalse(PushBindingPolicy.isReading(true, target.copy(accountId = "other"), target))
    }
}
