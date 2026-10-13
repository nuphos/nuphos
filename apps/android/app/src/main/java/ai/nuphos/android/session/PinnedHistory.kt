package ai.nuphos.android.session

import ai.nuphos.android.data.ConversationActions

/** Favorites remain server-owned. These shortcuts never resolve conversation details. */
object PinnedHistory {
    data class Shortcut(val sessionId: String, val title: String) {
        val listKey: String get() = "pin:$sessionId"
    }

    fun shortcuts(favorites: ConversationActions.Favorites?, search: String, archivedOnly: Boolean): List<Shortcut> {
        if (search.isNotEmpty() || archivedOnly) return emptyList()
        return favorites?.entries.orEmpty().mapNotNull { entry ->
            val key = entry["key"]?.stringValue ?: return@mapNotNull null
            if (!key.startsWith("agent-session:")) return@mapNotNull null
            val id = key.removePrefix("agent-session:").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            Shortcut(id, entry["label"]?.stringValue?.takeIf { it.isNotBlank() } ?: "Chat")
        }.distinctBy { it.sessionId }
    }

    fun shouldLoadMore(visibleKeys: List<Any>, normalSessionIds: List<String>): Boolean {
        if (normalSessionIds.isEmpty()) return false
        return normalSessionIds.takeLast(3).any { "history:$it" in visibleKeys }
    }

    /** A team round trip and a newer read/write both expire earlier results. */
    class Requests {
        data class Ticket(val teamId: String, val generation: Long)
        private var generation = 0L
        fun invalidate() { generation++ }
        fun begin(teamId: String) = Ticket(teamId, ++generation)
        fun accepts(ticket: Ticket, selectedTeamId: String?, allowed: Boolean) =
            allowed && ticket.teamId == selectedTeamId && ticket.generation == generation
    }
}
