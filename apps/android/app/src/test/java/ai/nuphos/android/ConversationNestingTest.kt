package ai.nuphos.android

import ai.nuphos.android.data.Http
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.session.ConversationNesting
import org.junit.Assert.*
import org.junit.Test

class ConversationNestingTest {
    private fun row(id: String, parent: String? = null, mine: Boolean = true) =
        AgentConversation(sessionId = id, teamId = "team", parentSessionId = parent, isOwner = mine)
    @Test fun decodesExistingParentAndOldResponses() {
        assertEquals("parent", Http.json.decodeFromString<AgentConversation>("""{"sessionId":"child","parentSessionId":"parent"}""").parentSessionId)
        assertNull(Http.json.decodeFromString<AgentConversation>("""{"sessionId":"old"}""").parentSessionId)
    }
    @Test fun stablePreorderCountsFoldAndDuplicate() {
        val input = listOf(row("child", "root"), row("root"), row("other"), row("grandchild", "child"), row("child"))
        val open = ConversationNesting.nest(input).rows
        assertEquals(listOf("root", "child", "grandchild", "other"), open.map { it.conversation.sessionId })
        assertEquals(listOf(0, 1, 2, 0), open.map { it.depth })
        assertEquals(2, open.first().threads)
        assertEquals(listOf("root", "other"), ConversationNesting.nest(input, folded = setOf("root")).rows.map { it.conversation.sessionId })
    }
    @Test fun pinnedSubtreesAndIndependentPinnedChildAreUnique() {
        val rows = listOf(row("root"), row("child", "root"), row("leaf", "child"))
        val result = ConversationNesting.nest(rows, pinned = setOf("child"))
        assertEquals(listOf("child", "leaf", "root"), result.rows.map { it.conversation.sessionId })
        assertEquals(listOf(0, 1, 0), result.rows.map { it.depth })
        assertEquals(ConversationNesting.Section.Pinned, result.rows[1].section)
        assertEquals(listOf("root"), ConversationNesting.nest(rows, pinned = setOf("root"), folded = setOf("root")).rows.map { it.conversation.sessionId })
    }
    @Test fun sharedAndMineRemainSeparateButPinnedParentKeepsAuthorizedChildren() {
        val rows = listOf(row("mine"), row("shared", "mine", false), row("shared-child", "shared", false))
        val tree = ConversationNesting.nest(rows).rows
        assertEquals(listOf(0, 0, 1), tree.map { it.depth })
        assertEquals(0, tree.first().threads)
        assertEquals(1, tree[1].threads)
        assertTrue(ConversationNesting.nest(rows, pinned = setOf("mine")).rows.all { it.section == ConversationNesting.Section.Pinned })
    }
    @Test fun missingParentsSearchPagesCyclesAndCrossTeamAreSafe() {
        val child = row("child", "later")
        assertEquals(0, ConversationNesting.nest(listOf(child)).rows.single().depth)
        assertEquals(listOf("later", "child"), ConversationNesting.nest(listOf(child, row("later"))).rows.map { it.conversation.sessionId })
        val bad = listOf(row("a", "b"), row("b", "a"), row("self", "self"), row("orphan", "missing"))
        assertEquals(bad.map { it.sessionId }.toSet(), ConversationNesting.nest(bad).rows.map { it.conversation.sessionId }.toSet())
        assertEquals(0, ConversationNesting.nest(listOf(row("parent"), row("child", "parent").copy(teamId = "other"))).rows.last().depth)
    }
    @Test fun deepChainUsesNoRecursionAndCountsAllDescendants() {
        val rows = (0 until 20_000).map { row("$it", if (it == 0) null else "${it - 1}") }
        val result = ConversationNesting.nest(rows)
        assertEquals(20_000, result.rows.size)
        assertEquals(19_999, result.rows.first().threads)
        assertEquals(19_999, result.rows.last().depth)
        assertEquals(1, ConversationNesting.nest(rows, folded = setOf("0")).rows.size)
    }
}
