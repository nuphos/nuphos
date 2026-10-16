package ai.nuphos.android

import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.ui.chat.SessionMention
import ai.nuphos.android.ui.chat.SessionMentionSource
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class SessionMentionTest {
    @Test fun triggersOnlyForTrailingBoundedTokens() {
        listOf("@" to "", "@hello" to "hello", "context @hello" to "hello",
            "context\n@中文" to "中文", "@old @new" to "new", "@".plus("a".repeat(40)) to "a".repeat(40))
            .forEach { (text, query) -> assertEquals(text, query, SessionMention.query(text)) }
        listOf("", "name@example.com", "a@b", "@hello world", "@hello\n", "@" + "a".repeat(41))
            .forEach { assertNull(it, SessionMention.query(it)) }
    }

    @Test fun requiresTrailingCaretAndSupportsImeComposition() {
        assertNull(SessionMention.query(TextFieldValue("@abc", TextRange(1))))
        assertNull(SessionMention.query(TextFieldValue("@abc", TextRange(0, 4))))
        assertEquals("abc", SessionMention.query(TextFieldValue("@abc", TextRange(4), TextRange(1, 4))))
        assertEquals("abc", SessionMention.query(TextFieldValue("@abc", TextRange(4))))
    }

    @Test fun insertionPreservesPrefixAndAddsExactlyOneSpace() {
        val link = SessionMention.link("team", "session")
        assertEquals("https://nuphos.ai/teams/team/agent/session", link)
        assertEquals("first line\ncontext $link ", SessionMention.insert("first line\ncontext @abc", link))
        assertEquals("name@example.com", SessionMention.insert("name@example.com", link))
    }

    @Test fun filtersCurrentOtherTeamNonownedArchivedAndDuplicateRowsBeforeLimit() {
        val source = SessionMentionSource("team", "current") { emptyList() }
        val rows = listOf(
            AgentConversation("current"), AgentConversation("other", teamId = "other-team"),
            AgentConversation("shared", isOwner = false), AgentConversation("archived", archivedAt = Instant.EPOCH),
            AgentConversation("invalid/path"), AgentConversation("valid"), AgentConversation("valid"),
        ) + (1..8).map { AgentConversation("own-$it", teamId = "team", isOwner = true) }
        assertEquals(listOf("valid", "own-1", "own-2", "own-3", "own-4"),
            SessionMention.results(rows, source).map { it.sessionId })
    }
}
