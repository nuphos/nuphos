package ai.nuphos.android.session

import ai.nuphos.android.model.AgentConversation

/** A bounded, iterative forest over the authorized, loaded page only. No detail fetches. */
object ConversationNesting {
    enum class Section(val title: String) { Pinned("Pinned"), Mine("My agents"), Shared("Shared") }
    data class Row(
        val conversation: AgentConversation,
        val section: Section,
        val depth: Int,
        val threads: Int,
        val folded: Boolean,
        val hidden: List<AgentConversation> = emptyList(),
        val trail: List<Boolean> = emptyList(),
    )
    data class Result(val rows: List<Row>, val loadedPinnedIds: Set<String>)

    fun nest(
        conversations: List<AgentConversation>, pinned: Set<String> = emptySet(),
        folded: Set<String> = emptySet(), accountId: String? = null, groupSections: Boolean = true,
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
            if (groupSections && p != null && sections[p] != sections[row.sessionId]) parent[row.sessionId] = null
            children[row.sessionId].orEmpty().asReversed().forEach(stack::addLast)
        }
        // Rebuild after cross-section cuts: newly promoted roots retain source order,
        // rather than their former parent's position in the first traversal.
        val finalChildren = rows.groupBy { parent[it.sessionId] }
        finalChildren[null].orEmpty().asReversed().forEach(stack::addLast)
        while (stack.isNotEmpty()) {
            val row = stack.removeLast()
            depths[row.sessionId] = parent[row.sessionId]?.let { depths.getValue(it) + 1 } ?: 0
            order += row
            finalChildren[row.sessionId].orEmpty().asReversed().forEach(stack::addLast)
        }
        val counts = mutableMapOf<String, Int>()
        for (row in order.asReversed()) {
            val p = parent[row.sessionId] ?: continue
            counts[p] = (counts[p] ?: 0) + 1 + (counts[row.sessionId] ?: 0)
        }
        val hiddenRoot = mutableMapOf<String, String>()
        val hiddenChildren = mutableMapOf<String, MutableList<AgentConversation>>()
        val trails = mutableMapOf<String, List<Boolean>>()
        val visible = mutableListOf<Row>()
        for (row in order) {
            val id = row.sessionId
            val p = parent[id]
            trails[id] = if (p == null) emptyList() else
                (trails[p].orEmpty() + (finalChildren[p]?.lastOrNull()?.sessionId != id)).take(4)
            val foldedRoot = hiddenRoot[p] ?: p?.takeIf { it in folded }
            if (foldedRoot != null) {
                hiddenRoot[id] = foldedRoot
                hiddenChildren.getOrPut(foldedRoot) { mutableListOf() }.add(row)
                continue
            }
            visible += Row(row, sections.getValue(id), depths.getValue(id), counts[id] ?: 0, id in folded, trail = trails[id].orEmpty())
        }
        val displayed = if (groupSections) Section.entries.flatMap { section -> visible.filter { it.section == section } } else visible
        return Result(displayed.map { it.copy(hidden = hiddenChildren[it.conversation.sessionId].orEmpty()) },
            rows.filter { it.sessionId in pinned }.mapTo(mutableSetOf()) { it.sessionId })
    }
    /** Only visible folded roots retain hidden rows, so total retained descendants stays O(n). */
    fun status(row: Row, label: (AgentConversation) -> String?): String? =
        (sequenceOf(row.conversation) + row.hidden.asSequence())
            .mapNotNull { label(it) ?: if (HistoryStatus.unread(it)) "Unread" else null }
            .maxByOrNull { when (it) { "Running" -> 4; "Paused" -> 3; "Background tools" -> 2; else -> 1 } }

}
