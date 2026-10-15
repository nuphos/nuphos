package ai.nuphos.android.session

import ai.nuphos.android.model.AgentConversation

/** A bounded, iterative forest over the authorized, loaded page only. No detail fetches. */
object ConversationNesting {
    enum class Section(val title: String) { Pinned("Pinned"), Mine("My chats"), Shared("Shared") }
    data class Row(
        val conversation: AgentConversation,
        val section: Section,
        val depth: Int,
        val threads: Int,
        val folded: Boolean,
    )
    data class Result(val rows: List<Row>, val loadedPinnedIds: Set<String>)

    fun nest(
        conversations: List<AgentConversation>, pinned: Set<String> = emptySet(),
        folded: Set<String> = emptySet(), accountId: String? = null,
    ): Result {
        val rows = conversations.distinctBy { it.sessionId }
        val byId = rows.associateBy { it.sessionId }
        val parent = rows.associate { row ->
            val candidate = row.parentSessionId?.let(byId::get)
            row.sessionId to candidate?.takeIf {
                it.sessionId != row.sessionId && it.teamId == row.teamId &&
                    (row.sessionId !in pinned || it.sessionId in pinned)
            }?.sessionId
        }.toMutableMap()
        // Break one edge per cycle. Each node is visited at most once, including deep chains.
        val done = mutableSetOf<String>()
        for (row in rows) {
            val path = mutableSetOf<String>()
            var id: String? = row.sessionId
            while (id != null && id !in done) {
                if (!path.add(id)) { parent[id] = null; break }
                id = parent[id]
            }
            done.addAll(path)
        }
        val children = rows.groupBy { parent[it.sessionId] }
        val sections = mutableMapOf<String, Section>()
        val depths = mutableMapOf<String, Int>()
        val order = mutableListOf<AgentConversation>()
        val stack = ArrayDeque<AgentConversation>()
        children[null].orEmpty().asReversed().forEach(stack::addLast)
        while (stack.isNotEmpty()) {
            val row = stack.removeLast()
            val p = parent[row.sessionId]
            sections[row.sessionId] = when {
                row.sessionId in pinned || p?.let { sections[it] } == Section.Pinned -> Section.Pinned
                row.isOwner == true || (row.isOwner == null && (row.owner == null || row.owner.id == accountId)) -> Section.Mine
                else -> Section.Shared
            }
            // Cross-section children remain visible roots in their own section.
            if (p != null && sections[p] != sections[row.sessionId]) parent[row.sessionId] = null
            depths[row.sessionId] = parent[row.sessionId]?.let { depths.getValue(it) + 1 } ?: 0
            order += row
            children[row.sessionId].orEmpty().asReversed().forEach(stack::addLast)
        }
        val counts = mutableMapOf<String, Int>()
        for (row in order.asReversed()) {
            val p = parent[row.sessionId] ?: continue
            counts[p] = (counts[p] ?: 0) + 1 + (counts[row.sessionId] ?: 0)
        }
        val hidden = mutableSetOf<String>()
        val visible = mutableListOf<Row>()
        for (row in order) {
            val id = row.sessionId
            val p = parent[id]
            if (p in hidden || (p != null && p in folded)) { hidden += id; continue }
            visible += Row(row, sections.getValue(id), depths.getValue(id), counts[id] ?: 0, id in folded)
        }
        return Result(Section.entries.flatMap { section -> visible.filter { it.section == section } },
            rows.filter { it.sessionId in pinned }.mapTo(mutableSetOf()) { it.sessionId })
    }
}
