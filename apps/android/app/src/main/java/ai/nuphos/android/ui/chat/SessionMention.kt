package ai.nuphos.android.ui.chat

import ai.nuphos.android.model.AgentConversation
import androidx.compose.ui.text.input.TextFieldValue

/** Session links only: mentioning a conversation never changes credentials. */
data class SessionMentionSource(
    val teamId: String,
    val excludedSessionId: String? = null,
    val search: suspend (String) -> List<AgentConversation>,
)

object SessionMention {
    fun query(text: String): String? {
        val at = text.lastIndexOf('@')
        if (at < 0 || (at > 0 && !text[at - 1].isWhitespace())) return null
        val query = text.substring(at + 1)
        return query.takeIf { it.codePointCount(0, it.length) <= 40 && it.none(Char::isWhitespace) }
    }

    // A trailing mention can only be picked while the caret is at the end.
    // Preserve the IME composition while typing; picking explicitly commits the link.
    fun query(value: TextFieldValue): String? =
        if (!value.selection.collapsed || value.selection.end != value.text.length) null
        else query(value.text)

    fun insert(text: String, link: String): String =
        if (query(text) == null) text else text.substring(0, text.lastIndexOf('@')) + link + " "

    fun results(rows: List<AgentConversation>, source: SessionMentionSource): List<AgentConversation> =
        rows.filter {
            it.sessionId != source.excludedSessionId &&
                (it.teamId == null || it.teamId == source.teamId) &&
                it.isOwner != false && !it.isArchived &&
                it.sessionId.matches(Regex("[A-Za-z0-9][A-Za-z0-9_-]{0,127}"))
        }.distinctBy { it.sessionId }.take(5)

    fun link(teamId: String, sessionId: String): String = ai.nuphos.android.session.ConversationLink(teamId, sessionId).url
}
