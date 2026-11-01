package ai.nuphos.android

import ai.nuphos.android.ui.chat.MessagePreview
import org.junit.Assert.*
import org.junit.Test

class MessagePreviewTest {
    @Test fun shortAndNearlyShortMessagesStayWhole() {
        assertNull(MessagePreview.head("That fixed it, thanks!"))
        assertNull(MessagePreview.head("a ".repeat(145)))
        assertNull(MessagePreview.head((1..7).joinToString("\n") { "line $it" }))
    }
    @Test fun longLogsFoldAtSixLinesAndWordsRemainWhole() {
        val lines = (1..20).map { "line $it of a pasted log with some detail" }
        assertEquals(lines.take(6).joinToString("\n") + "…", MessagePreview.head(lines.joinToString("\n")))
        assertTrue(MessagePreview.head("word ".repeat(200))!!.endsWith("word…"))
        assertEquals("x".repeat(280) + "…", MessagePreview.head("x".repeat(1000)))
    }
    @Test fun unicodePreviewNeverSplitsASurrogatePair() {
        val preview = MessagePreview.head("😀".repeat(500))!!
        assertEquals("😀".repeat(280) + "…", preview)
    }
}
