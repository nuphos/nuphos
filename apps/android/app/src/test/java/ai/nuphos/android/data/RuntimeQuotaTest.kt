package ai.nuphos.android.data

import org.junit.Assert.assertEquals
import org.junit.Test

class RuntimeQuotaTest {
    private fun left(used: Double) = RuntimeQuota.Window(label = "5-hour", usedPercent = used).leftPercent

    @Test fun leftRoundsDownLikeDesktopAndIos() {
        assertEquals(87, left(12.5))
        assertEquals(13, left(87.0))
        assertEquals(64, left(35.4))
        assertEquals(0, left(99.6))
        assertEquals(100, left(0.0))
        assertEquals(0, left(100.0))
    }
}
