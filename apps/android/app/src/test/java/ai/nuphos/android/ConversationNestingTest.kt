package ai.nuphos.android

import ai.nuphos.android.data.Http
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.ConversationWorkspace
import ai.nuphos.android.model.InputRequest
import java.time.Instant
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
    @Test fun tasksRankFamiliesByWaitingThenNewestDescendantEvenWhenFolded() {
        val rows = listOf(
            row("recent").copy(lastActiveAt = Instant.ofEpochSecond(8)),
            row("active-parent"),
            row("active-child", "active-parent").copy(lastActiveAt = Instant.ofEpochSecond(10)),
            row("waiting-parent"),
            row("waiting-child", "waiting-parent").copy(
                inputRequests = listOf(InputRequest("q", "approval", "Continue?", null)),
            ),
        )

        val tree = ConversationNesting.nest(rows, folded = setOf("waiting-parent"), attention = { it.isWaiting }).rows
        assertEquals(listOf("waiting-parent", "active-parent", "active-child", "recent"),
            tree.map { it.conversation.sessionId })
        assertEquals(listOf("waiting-child"), tree.first().hidden.map { it.sessionId })
    }

    @Test fun sharedAndMineRemainSeparate() {
        val rows = listOf(row("mine"), row("shared", "mine", false), row("shared-child", "shared", false))
        val tree = ConversationNesting.nest(rows).rows
        assertEquals(listOf(0, 0, 1), tree.map { it.depth })
        assertEquals(0, tree.first().threads)
        assertEquals(1, tree[1].threads)
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
    @Test fun foldedRootsKeepHiddenActivityWithoutDuplicatingDescendants() {
        val rows = listOf(row("root"), row("child", "root"), row("leaf", "child"), row("other"))
        val folded = ConversationNesting.nest(rows, folded = setOf("root", "child")).rows
        assertEquals(listOf("child", "leaf"), folded.first().hidden.map { it.sessionId })
        assertEquals("Running", ConversationNesting.status(folded.first()) { if (it.sessionId == "leaf") "Running" else null })
        assertNull(ConversationNesting.status(folded.last()) { null })
        assertTrue(ConversationNesting.nest(rows).rows.all { it.hidden.isEmpty() })
    }

    @Test fun promotedSharedRootsRetainTheirSourceOrder() {
        val rows = listOf(row("S1", "M2", false), row("S2", mine = false), row("M2"))
        val shared = ConversationNesting.nest(rows).rows.filter { it.section == ConversationNesting.Section.Shared }
        assertEquals(listOf("S1", "S2"), shared.map { it.conversation.sessionId })
        assertTrue(shared.all { it.depth == 0 })
    }

    private fun at(id: String, parent: String? = null, active: Long, path: String? = null) =
        row(id, parent).copy(lastActiveAt = Instant.ofEpochSecond(active), workspace = path?.let { ConversationWorkspace(it) })
    private val asking = at("asking", active = 1).copy(inputRequests = listOf(InputRequest("q", null, "Ship?", null)))

    @Test fun familiesThatNeedTheViewerComeFirstAboveADivider() {
        val rows = listOf(at("recent", active = 30), at("old", active = 10), at("busy", "old", active = 40), asking)
        val waiting = ConversationNesting.nest(rows, attention = { it.isWaiting }).rows
        assertEquals(listOf("asking", "old", "busy", "recent"), waiting.map { it.conversation.sessionId })
        assertEquals(listOf("old"), waiting.filter { it.divider }.map { it.conversation.sessionId })
        // Unread counts as needing the viewer, after an open question.
        val unread = ConversationNesting.nest(rows, attention = { it.isWaiting || it.sessionId == "recent" }).rows
        assertEquals(listOf("asking", "recent", "old", "busy"), unread.map { it.conversation.sessionId })
        assertEquals(listOf("old"), unread.filter { it.divider }.map { it.conversation.sessionId })
        // A child's unread activity lifts its whole family.
        val child = ConversationNesting.nest(rows, attention = { it.isWaiting || it.sessionId == "busy" }).rows
        assertEquals(listOf("asking", "old", "busy", "recent"), child.map { it.conversation.sessionId })
        assertEquals(listOf("recent"), child.filter { it.divider }.map { it.conversation.sessionId })
        // With nothing to ask, or everything asking, there is no line.
        assertTrue(ConversationNesting.nest(rows, attention = { false }).rows.none { it.divider })
        assertTrue(ConversationNesting.nest(rows, attention = { true }).rows.none { it.divider })
    }

    @Test fun tasksGroupUnderTheirProjectsThenNoProject() {
        val rows = listOf(at("site", active = 30, path = "/work/site"), at("loose", active = 20),
            at("fix", "site", active = 10, path = "/work/site"), at("api", active = 40, path = "C:\\work\\api"))
        val grouped = ConversationNesting.withProjects(rows, "No project")
        assertEquals(listOf("project:/work/site", "project:C:\\work\\api", ConversationNesting.NO_PROJECT),
            grouped.take(3).map { it.sessionId })
        assertEquals(listOf("site", "api", "No project"), grouped.take(3).map { it.title })
        assertTrue(grouped.take(3).all { it.isProject } && grouped.drop(3).none { it.isProject })
        // A thread stays under the Task that opened it; projects cross no team line.
        val tree = ConversationNesting.nest(grouped, groupSections = false, attention = { false }).rows
        assertEquals(listOf("project:C:\\work\\api", "api", "project:/work/site", "site", "fix", ConversationNesting.NO_PROJECT, "loose"),
            tree.map { it.conversation.sessionId })
        assertEquals(listOf(0, 1, 0, 1, 2, 0, 1), tree.map { it.depth })
        // A project folds what it holds, with the same fold state as threads.
        val folded = ConversationNesting.nest(grouped, folded = setOf("project:/work/site"), groupSections = false, attention = { false }).rows
        assertEquals(listOf("site", "fix"), folded.single { it.conversation.sessionId == "project:/work/site" }.hidden.map { it.sessionId })
    }

    @Test fun withoutAnyFolderTheListStaysFlat() {
        val rows = listOf(at("a", active = 2), at("b", "a", active = 1))
        assertEquals(rows, ConversationNesting.withProjects(rows, "No project"))
        assertEquals("api", ConversationNesting.projectName("/work/api/"))
        assertEquals("/work/site", Http.json.decodeFromString<AgentConversation>("""{"sessionId":"t","workspace":{"path":"/work/site"}}""").workspace?.path)
        assertNull(Http.json.decodeFromString<AgentConversation>("""{"sessionId":"t"}""").workspace)
    }

}
