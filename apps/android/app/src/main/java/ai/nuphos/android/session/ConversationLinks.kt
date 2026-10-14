package ai.nuphos.android.session

import java.net.URI
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Public IDs are destinations only, never credentials. No query parameters are supported. */
data class ConversationLink(val teamId: String, val conversationId: String) {
    val url get() = "https://nuphos.ai/teams/$teamId/agent/$conversationId"

    companion object {
        private val path = Regex("/teams/([a-fA-F0-9]{24})/agent/([A-Za-z0-9][A-Za-z0-9_-]{0,127})/?")
        fun parse(value: String): ConversationLink? = runCatching {
            val uri = URI(value)
            if (uri.scheme != "https" || uri.rawAuthority != "nuphos.ai" ||
                uri.rawQuery != null || uri.rawFragment != null) return null
            val match = path.matchEntire(uri.rawPath ?: return null) ?: return null
            ConversationLink(match.groupValues[1], match.groupValues[2])
        }.getOrNull()
    }
}

/** A new tap supersedes an older one. Completion of an old request cannot consume a new tap. */
class PendingConversationLink {
    data class Request(val sequence: Long, val destination: ConversationLink)
    private var sequence = 0L
    private val mutable = MutableStateFlow<Request?>(null)
    val value = mutable.asStateFlow()
    fun offer(destination: ConversationLink) { mutable.value = Request(++sequence, destination) }
    fun restore(url: String?) {
        if (mutable.value == null) url?.let(ConversationLink::parse)?.let(::offer)
    }
    fun complete(request: Request): Boolean {
        if (mutable.value != request) return false
        mutable.value = null
        return true
    }
}

/** Fresh membership and detail reads precede workspace changes and navigation. */
class ConversationLinkAccess<T>(
    private val memberships: suspend () -> List<T>,
    private val teamId: (T) -> String,
    private val conversation: suspend (ConversationLink) -> Unit,
) {
    suspend fun resolve(destination: ConversationLink, isCurrent: () -> Boolean = { true }): Pair<List<T>, T>? {
        if (!isCurrent()) return null
        val teams = memberships()
        if (!isCurrent()) return null
        val team = teams.firstOrNull { teamId(it) == destination.teamId } ?: return null
        conversation(destination)
        if (!isCurrent()) return null
        return teams to team
    }
}
