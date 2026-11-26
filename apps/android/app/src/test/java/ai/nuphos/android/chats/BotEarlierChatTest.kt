package ai.nuphos.android.chats

import ai.nuphos.android.data.Http
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.BotEarlierChat
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

/** An older Bot's empty chat leads back to the Bot's own session, as Desktop decides it (#5061). */
class BotEarlierChatTest {
    private fun bot(messages: Int, lastActive: String, onboarding: String? = null) = Http.json.decodeFromString<AgentConversation>(
        """{"sessionId":"bot-1","title":"Ada","messageCount":$messages,"lastActiveAt":"$lastActive","avatar":"07-ada"${
            onboarding?.let { ",\"botOnboarding\":\"$it\"" } ?: ""}}""")

    private val chat = Http.json.decodeFromString<AgentConversationDetail>(
        """{"kind":"channel","title":"Ada","createdAt":"2026-11-25T02:00:00.000Z","messages":[]}""").createdAt

    @Test fun aChatReadsWhenItWasMade() {
        assertEquals(Instant.parse("2026-11-25T02:00:00Z"), chat)
    }

    @Test fun aBotThatLastMovedBeforeItsChatWasMadeHasEarlierMessages() {
        assertTrue(BotEarlierChat.shows(bot(12, "2026-11-17T08:00:00.000Z"), chat))
    }

    @Test fun aBotThatOnlyMovedOnceItsChatExistedHasNothingEarlier() {
        assertFalse(BotEarlierChat.shows(bot(3, "2026-11-25T02:00:05.000Z"), chat))
    }

    @Test fun aBotWithNoMessagesOrNoRowHasNothingEarlier() {
        assertFalse(BotEarlierChat.shows(bot(0, "2026-11-17T08:00:00.000Z"), chat))
        assertFalse(BotEarlierChat.shows(null, chat))
        assertFalse(BotEarlierChat.shows(bot(4, "2026-11-17T08:00:00.000Z"), null))
    }

    @Test fun anUnreadableTimeSaysNothingIsEarlier() {
        assertFalse(BotEarlierChat.shows(bot(4, ""), chat))
        val unreadable = Http.json.decodeFromString<AgentConversationDetail>("""{"createdAt":"soon","messages":[]}""").createdAt
        assertFalse(BotEarlierChat.shows(bot(4, "2026-11-17T08:00:00.000Z"), unreadable))
    }

    @Test fun aBotStillBeingSetUpHasNothingEarlier() {
        assertFalse(BotEarlierChat.shows(bot(4, "2026-11-17T08:00:00.000Z", onboarding = "active"), chat))
        assertFalse(BotEarlierChat.shows(bot(4, "2026-11-17T08:00:00.000Z", onboarding = "pending"), chat))
        assertTrue(BotEarlierChat.shows(bot(4, "2026-11-17T08:00:00.000Z", onboarding = "done"), chat))
    }
}
