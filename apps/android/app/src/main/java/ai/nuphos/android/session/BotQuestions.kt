package ai.nuphos.android.session

import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.InputRequest

/** An open question a Bot's chat shows: one request and the conversation that asked it. */
data class BotQuestion(val sessionId: String, val title: String, val request: InputRequest) {
    val id: String get() = "$sessionId:${request.id}"

    /** The conversation that asked, opened in the app like any Nuphos link. */
    fun link(teamId: String): String = "${ai.nuphos.android.data.NuphosWeb.SITE_URL}/teams/$teamId/agent/$sessionId"

    /** Answered in words, "Other…": never a plan, approved or rejected, nor a credential or connection. */
    val typed: Boolean get() = request.category != "credential" && request.category != "integration" && request.planId == null

    /**
     * The member's own credentials an integration question names, answered only by adding them to
     * `personalCredentialIds`; null unless every named credential is personal and no providers are mixed in.
     */
    val personalCredentials: List<String>? get() = request.credentials
        ?.takeIf { request.providers == null && it.isNotEmpty() && it.all { ref -> ref.provider == "personal" } }
        ?.map { it.id }

    /** An integration question the Inbox answers in place: by its providers, or by the member's own credentials. */
    val connectable: Boolean get() = request.category == "integration" && (request.credentials == null || personalCredentials != null)
}

/**
 * The open questions in the pending listing, whose rows come with every parent above them: all of
 * them for the Inbox, or, as Desktop's `sessionInputRequests` for a Bot's chat (#1848), those of
 * the Bot and of every conversation under it, at any depth.
 */
object BotQuestions {
    /** The viewer's own questions under [bot], oldest first. */
    fun under(bot: String, rows: List<AgentConversation>): List<BotQuestion> {
        val parent = rows.distinctBy { it.sessionId }.associate { it.sessionId to it.parentSessionId }
        fun isUnder(sessionId: String): Boolean {
            val seen = mutableSetOf<String>()
            var current: String? = sessionId
            while (current != null && seen.add(current)) {
                if (current == bot) return true
                current = parent[current]
            }
            return false
        }
        return open(rows.filter { isUnder(it.sessionId) })
    }

    /** The viewer's own open questions in [rows], oldest first: the Inbox's list. */
    fun open(rows: List<AgentConversation>): List<BotQuestion> {
        return rows.distinctBy { it.sessionId }
            .filter { it.isOwner == true }
            .flatMap { row -> row.inputRequests.orEmpty().map { BotQuestion(row.sessionId, row.displayTitle, it) } }
            .sortedWith(compareBy({ it.request.askedAt.orEmpty() }, { it.id }))
    }
}
