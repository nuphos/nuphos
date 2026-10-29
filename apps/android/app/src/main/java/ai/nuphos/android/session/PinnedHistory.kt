package ai.nuphos.android.session

import ai.nuphos.android.data.ConversationActions

/** Favorites remain server-owned. These shortcuts never resolve conversation details. */
object PinnedHistory {
    data class Shortcut(val sessionId: String, val title: String) {
        val listKey: String get() = "pin:$sessionId"
    }

    fun shortcuts(favorites: ConversationActions.Favorites?, search: String, archivedOnly: Boolean): List<Shortcut> {
        if (search.isNotEmpty() || archivedOnly) return emptyList()
        return favorites?.entries.orEmpty().asReversed().mapNotNull { entry ->
            val id = ConversationActions.favoriteSessionId(entry, favorites?.teamId) ?: return@mapNotNull null
            Shortcut(id, entry["label"]?.stringValue?.takeIf { it.isNotBlank() } ?: "Agent")
        }.distinctBy { it.sessionId }
    }

    sealed interface Item {
        val key: String
        data class Loaded(val row: ConversationNesting.Row) : Item {
            override val key get() = "history:${row.conversation.sessionId}"
        }
        data class Missing(val shortcut: Shortcut) : Item {
            override val key get() = shortcut.listKey
        }
    }

    /** Rank only explicit pins; stable sort leaves the selected history order intact. */
    fun nest(conversations: List<ai.nuphos.android.model.AgentConversation>, pins: List<Shortcut>,
             folded: Set<String>, accountId: String?): ConversationNesting.Result {
        val rank = pins.map { it.sessionId }.distinct().withIndex().associate { it.value to it.index }
        val ordered = conversations.distinctBy { it.sessionId }.sortedBy { rank[it.sessionId] ?: Int.MAX_VALUE }
        return ConversationNesting.nest(ordered, rank.keys, folded, accountId, groupSections = false)
    }

    /** Merge unloaded shortcuts into pin rank without splitting loaded parent/child blocks. */
    fun items(tree: ConversationNesting.Result, pins: List<Shortcut>): List<Item> {
        val blocks = linkedMapOf<String, MutableList<Item>>()
        var root: MutableList<Item>? = null
        for (row in tree.rows) {
            if (row.depth == 0 || root == null) {
                root = mutableListOf()
                blocks[row.conversation.sessionId] = root
            }
            root.add(Item.Loaded(row))
        }
        val result = mutableListOf<Item>()
        for (pin in pins.distinctBy { it.sessionId }) {
            val loaded = blocks.remove(pin.sessionId)
            if (loaded != null) result.addAll(loaded)
            else if (pin.sessionId !in tree.loadedPinnedIds) result.add(Item.Missing(pin))
        }
        blocks.values.forEach(result::addAll)
        return result
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
