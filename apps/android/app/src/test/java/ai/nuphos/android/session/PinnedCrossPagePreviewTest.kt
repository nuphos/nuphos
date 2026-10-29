package ai.nuphos.android.session

import ai.nuphos.android.model.AgentConversation
import org.junit.Assert.*
import org.junit.Test

class PinnedCrossPagePreviewTest {
    @Test fun firstPageIncludesAuthorizedParentsWithoutScanningHistory() {
        val page = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }.decodeFromString<ai.nuphos.android.model.AgentConversationsPage>(
            """{"conversations":[{"sessionId":"child","teamId":"team","parentSessionId":"parent"}],"parents":[{"sessionId":"parent","teamId":"team"}],"nextCursor":"older","hasMore":true}"""
        )
        val pins = listOf(PinnedHistory.Shortcut("parent", "Pinned parent"))
        val tree = PinnedHistory.nest(page.rows, pins, emptySet(), "viewer")
        assertEquals(listOf("parent", "child"), tree.rows.map { it.conversation.sessionId })
        assertEquals(listOf(0, 1), tree.rows.map { it.depth })
        assertTrue(PinnedHistory.items(tree, pins).none { it is PinnedHistory.Item.Missing })
        assertEquals(1, tree.rows.first().threads)
        assertEquals("older", page.nextCursor)
        assertTrue(page.hasMore)
    }

    @Test fun unloadedPinnedParentBecomesOneFoldableTreeWhenNextPageArrives() {
        val pins = listOf(PinnedHistory.Shortcut("parent", "Pinned parent"))
        val recent = AgentConversation("recent", "team", "Recent")
        val parent = AgentConversation("parent", "team", "Pinned parent")
        val child = AgentConversation("child", "team", "Child", parentSessionId = "parent")
        val first = PinnedHistory.items(PinnedHistory.nest(listOf(recent), pins, emptySet(), "viewer"), pins)
        assertTrue(first.first() is PinnedHistory.Item.Missing)
        val tree = PinnedHistory.nest(listOf(recent, child, parent), pins, emptySet(), "viewer")
        val loaded = PinnedHistory.items(tree, pins)
        assertTrue(loaded.all { it is PinnedHistory.Item.Loaded })
        assertEquals(listOf("parent", "child", "recent"), loaded.map { (it as PinnedHistory.Item.Loaded).row.conversation.sessionId })
        assertEquals(listOf(0, 1, 0), tree.rows.map { it.depth })
        assertEquals(1, tree.rows.first().threads)
        val folded = PinnedHistory.nest(listOf(recent, child, parent), pins, setOf("parent"), "viewer")
        assertEquals(listOf("parent", "recent"), folded.rows.map { it.conversation.sessionId })
        assertEquals(listOf("child"), folded.rows.first().hidden.map { it.sessionId })
    }
}
