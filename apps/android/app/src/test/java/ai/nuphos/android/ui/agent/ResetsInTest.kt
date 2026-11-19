package ai.nuphos.android.ui.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class ResetsInTest {
    private val now = Instant.parse("2026-09-15T12:20:00Z")
    private fun at(minutes: Double) = now.plusMillis((minutes * 60_000).toLong())

    @Test fun daysAndHoursThenHoursAndMinutesThenMinutes() {
        assertEquals(ResetsIn(2, 5, 59), ResetsIn.of(at(2 * 1440 + 5 * 60 + 59.0), now))
        assertEquals(ResetsIn(1, 0, 0), ResetsIn.of(at(1440.0), now))
        assertEquals(ResetsIn(0, 3, 20), ResetsIn.of(at(3 * 60 + 20.0), now))
        assertEquals(ResetsIn(0, 0, 12), ResetsIn.of(at(12.0), now))
        // Under a minute still reads as a minute away, never as "0m".
        assertEquals(ResetsIn(0, 0, 1), ResetsIn.of(at(0.25), now))
    }

    @Test fun hiddenWhenUnknownOrPast() {
        assertNull(ResetsIn.of(null as String?, now))
        assertNull(ResetsIn.of("garbage", now))
        assertNull(ResetsIn.of(now, now))
        assertNull(ResetsIn.of("2026-09-15T11:00:00Z", now))
        assertEquals(ResetsIn(0, 0, 25), ResetsIn.of("2026-09-15T12:45:00Z", now))
    }
}
