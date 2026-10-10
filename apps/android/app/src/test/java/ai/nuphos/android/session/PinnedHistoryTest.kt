package ai.nuphos.android.session

import ai.nuphos.android.data.ConversationActions
import ai.nuphos.android.data.JsonValue
import org.junit.Assert.*
import org.junit.Test

class PinnedHistoryTest {
    private fun favorites(text: String) = ConversationActions.Favorites(JsonValue.parse(text)!!.arrayValue!!, 1)

    @Test fun onlyChatKeysBecomeDeduplicatedShortcutsWithNeutralMissingLabels() {
        val pins = PinnedHistory.shortcuts(favorites("""[
            {"key":"agent-session:beyond-page","label":"Saved title"},
            {"key":"agent-session:beyond-page","label":"Duplicate"},
            {"key":"agent-session:no-label"}, {"key":"agent-session:"},
            {"key":"dashboard:private","label":"Other"}, {"href":"/agent/other"}
        ]"""), "", false)
        assertEquals(listOf("beyond-page", "no-label"), pins.map { it.sessionId })
        assertEquals(listOf("Saved title", "Chat"), pins.map { it.title })
        assertEquals(2, pins.map { it.listKey }.toSet().size)
        assertFalse(pins.any { it.listKey == "history:${it.sessionId}" })
    }

    @Test fun searchAndArchiveHideShortcutsWithoutChangingFavoriteData() {
        val data = favorites("""[{"key":"agent-session:s","label":"Saved"}]""")
        assertTrue(PinnedHistory.shortcuts(data, "find", false).isEmpty())
        assertTrue(PinnedHistory.shortcuts(data, "", true).isEmpty())
        assertEquals(1, PinnedHistory.shortcuts(data, "", false).size)
        assertTrue(data.contains("s"))
    }

    @Test fun teamRoundTripAndNewerRequestRejectOldResponse() {
        val requests = PinnedHistory.Requests()
        val firstA = requests.begin("A")
        requests.invalidate()
        requests.begin("B")
        requests.invalidate()
        val nextA = requests.begin("A")
        assertFalse(requests.accepts(firstA, "A", true))
        assertTrue(requests.accepts(nextA, "A", true))
        assertFalse(requests.accepts(nextA, "A", false))
        assertFalse(requests.accepts(nextA, "B", true))
        requests.begin("A")
        assertFalse(requests.accepts(nextA, "A", true))
    }

    @Test fun paginationUsesNormalRowPositionsOnly() {
        assertFalse(PinnedHistory.shouldLoadMore(listOf("pins:header", "pin:s", "history:0"), listOf("0", "1", "2", "3", "4")))
        assertTrue(PinnedHistory.shouldLoadMore(listOf("pin:s", "history:2"), listOf("0", "1", "2", "3", "4")))
        assertFalse(PinnedHistory.shouldLoadMore(listOf("pin:s"), emptyList()))
    }
}
