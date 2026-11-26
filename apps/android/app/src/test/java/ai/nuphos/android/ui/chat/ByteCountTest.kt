package ai.nuphos.android.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

/** Expected sizes are what iOS's ByteCountFormatter (`.file` style) writes for the same counts. */
class ByteCountTest {
    private fun en(bytes: Long) = ByteCount.file(bytes, Locale.US).let { if (it.unit == null) "${it.number} bytes" else "${it.number} ${it.unit}" }

    @Test fun sizesReadAsOnIos() {
        assertEquals("1.2 MB", en(1_234_567))
        assertEquals("5 MB", en(5_000_000))
        assertEquals("18 bytes", en(18))
        assertEquals("12 kB", en(12_345))
        assertEquals("12.3 MB", en(12_345_678))
        assertEquals("1.23 GB", en(1_234_567_890))
        assertEquals("1.5 TB", en(1_500_000_000_000))
    }

    @Test fun roundsHalfToEvenAndCarriesIntoTheNextUnit() {
        assertEquals("2 kB", en(1_500)); assertEquals("2 kB", en(2_500)); assertEquals("4 kB", en(3_500))
        assertEquals("1.4 MB", en(1_350_000)); assertEquals("1.4 MB", en(1_450_000)); assertEquals("1.2 MB", en(1_250_000))
        assertEquals("1.24 GB", en(1_235_000_000)); assertEquals("1.22 GB", en(1_225_000_000))
        assertEquals("10 MB", en(9_999_999)); assertEquals("1 GB", en(999_950_000))
    }

    @Test fun nothingYetIsZeroKilobytes() = assertEquals(ByteCount.Amount("0", "kB"), ByteCount.file(0, Locale.US))

    @Test fun theNumberFollowsTheLocale() {
        assertEquals(ByteCount.Amount("1,2", "MB"), ByteCount.file(1_234_567, Locale.forLanguageTag("es-ES")))
        assertEquals(ByteCount.Amount("1,23", "GB"), ByteCount.file(1_234_567_890, Locale.forLanguageTag("id-ID")))
        assertEquals(ByteCount.Amount("1.2", "MB"), ByteCount.file(1_234_567, Locale.TRADITIONAL_CHINESE))
    }
}
