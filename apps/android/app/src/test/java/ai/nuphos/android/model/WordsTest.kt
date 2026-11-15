package ai.nuphos.android.model

import ai.nuphos.android.R
import ai.nuphos.android.data.AgentChatApi
import ai.nuphos.android.session.ChatSession
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

/** Text built outside Compose comes from strings_conversation_text.xml, so it follows the app language. */
class WordsTest {
    private val now = Instant.parse("2026-11-15T12:00:00Z")

    @Test fun relativeTimesReadTheStringsFile() {
        assertEquals("Just now", Words(R.string.convtext_just_now))
        assertEquals(Words(R.string.convtext_just_now), ChatTime.label(now, now))
        assertEquals(Words(R.string.convtext_minutes_ago, 5), ChatTime.label(now.minusSeconds(300), now))
        assertEquals("1 hr", HistoryTime.format(now.minusSeconds(3_600), now))
        assertEquals(Words.plural(R.plurals.convtext_age_hours, 4, 4), HistoryTime.format(now.minusSeconds(4 * 3_600), now))
        assertEquals("4 hrs", HistoryTime.format(now.minusSeconds(4 * 3_600), now))
    }

    @Test fun sessionAndApiMessagesReadTheStringsFile() {
        assertEquals(Words(R.string.convtext_phase_thinking), ChatSession.phaseLabel("thinking"))
        assertEquals(Words(R.string.convtext_conflict_busy), AgentChatApi.Conflict.ConversationBusy.message)
        assertEquals("This task is busy with another reply.", AgentChatApi.Conflict.ConversationBusy.message)
        assertEquals(Words(R.string.convtext_ask_admin), AgentChatApi.signInAsk("rt_team", "u1", isAdministrator = false))
    }
}
