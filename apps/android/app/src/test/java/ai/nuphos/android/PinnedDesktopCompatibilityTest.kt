package ai.nuphos.android

import ai.nuphos.android.data.ConversationActions
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.session.PinnedHistory
import org.junit.Assert.*
import org.junit.Test

class PinnedDesktopCompatibilityTest {
    @Test fun desktopSerializedChatHrefRemainsReachableWithoutLoadedHistory() {
        // Desktop use-sidebar-favorites pins href rows as {label, href}; the
        // sidebar store normalizes this same locator into its synced entries.
        val serialized = """[{"label":"Desktop saved chat","href":"/teams/A/agent/desktop-chat"},{"label":"Dashboard","href":"/dashboard"}]"""
        val favorites = ConversationActions.Favorites(JsonValue.parse(serialized)!!.arrayValue!!, 4)
        val pins = PinnedHistory.shortcuts(favorites, "", false)
        assertEquals(listOf("desktop-chat"), pins.map { it.sessionId })
        assertEquals("Desktop saved chat", pins.single().title)
    }
}
