package ai.nuphos.android.ui.chat

import ai.nuphos.android.R
import ai.nuphos.android.data.AgentChatApi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class UsageHoldNoticeTest {
    private val now = Instant.parse("2026-09-15T12:20:00Z")
    private fun notice(until: String?) = usageHoldNotice(AgentChatApi.UsageHold(until), now)

    @Test fun anOrdinaryQueueHasNoNotice() {
        assertNull(usageHoldNotice(null, now))
    }

    @Test fun saysWhenUsageResetsLikeDesktop() {
        assertEquals(UsageHoldNotice(R.string.composer_queue_usage_held_hours, listOf(1, 30)), notice("2026-09-15T13:50:00Z"))
        assertEquals(UsageHoldNotice(R.string.composer_queue_usage_held_days, listOf(2, 5)), notice("2026-09-17T17:20:00Z"))
        assertEquals(UsageHoldNotice(R.string.composer_queue_usage_held_minutes, listOf(12)), notice("2026-09-15T12:32:00Z"))
    }

    @Test fun withoutAKnownFutureResetItSaysOnlyThatUsageResets() {
        val plain = UsageHoldNotice(R.string.composer_queue_usage_held)
        assertEquals(plain, notice(null))
        assertEquals(plain, notice("garbage"))
        assertEquals(plain, notice("2026-09-15T11:00:00Z"))
    }
}
