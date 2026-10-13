package ai.nuphos.android

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.ChatPart
import ai.nuphos.android.model.ChatRow
import ai.nuphos.android.ui.chat.MemoryRecallAccess
import ai.nuphos.android.ui.chat.visibleTeamLabels
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatRowTest {
    private fun tool(id: String) = ChatPart.Tool(
        toolCallId = id,
        toolName = "terminal",
        isDynamic = false,
        state = ChatPart.Tool.State.OutputAvailable,
    )

    private fun message() = ChatMessage(
        id = "shared-history",
        parts = listOf(
            ChatPart.Reasoning(text = "First inspection"),
            tool("first"),
            ChatPart.Text(text = "Intermediate result"),
            ChatPart.Reasoning(text = "Second inspection"),
            tool("second"),
            ChatPart.Text(text = "Final result"),
        ),
    )

    @Test
    fun separateWorkGroupsHaveUniqueStableKeysAndPreserveHistory() {
        val rows = ChatRow.rows(listOf(message()))
        assertEquals("LazyColumn keys must be unique", rows.size, rows.map { it.id }.distinct().size)
        val groups = rows.filterIsInstance<ChatRow.Work>()
        assertEquals(2, groups.size)
        assertEquals(listOf("first", "second"), groups.flatMap { group ->
            group.rows.filterIsInstance<ChatRow.Tool>().map { it.part.toolCallId }
        })
        assertEquals(listOf("Intermediate result", "Final result"), rows.filterIsInstance<ChatRow.AssistantText>().map { it.text })
        val streamedTextUpdate = message().copy(parts = message().parts.dropLast(1) + ChatPart.Text(text = "Final result updated"))
        assertEquals(groups.map { it.id }, ChatRow.rows(listOf(streamedTextUpdate)).filterIsInstance<ChatRow.Work>().map { it.id })
    }

    @Test
    fun liveWorkRemainsVisibleUntilTheTurnFinishes() {
        val rows = ChatRow.rows(listOf(message()), isStreaming = true)
        assertTrue(rows.none { it is ChatRow.Work })
        assertEquals(2, rows.filterIsInstance<ChatRow.Tool>().size)
        assertTrue(rows.any { it is ChatRow.Activity })
    }
    private fun recall(json: String) = ChatRow.rows(listOf(ChatMessage(id = "recall-message",
        parts = listOf(ChatPart.Other(JsonValue.parse(json)!!))))).filterIsInstance<ChatRow.MemoryRecall>().single()

    @Test fun recallHidesPersonalLabelsAndUsesNeutralMissingLabel() {
        val row = recall("""{"type":"memory-provenance","recalledPersonalIds":["private-id"],"recalledTeamIds":["team-id"],"fetchedIds":["unknown-id"],"labels":{"private-id":"Private secret","unknown-id":"Unknown secret"}}""")
        assertEquals("Memory label unavailable", row.entries.first { it.scope == "team" }.label)
        assertTrue(row.entries.filter { it.scope != "team" }.all { it.label == "Details unavailable" })
        assertTrue(row.entries.none { it.label.contains("secret") || it.label.endsWith("-id") })
    }

    @Test fun personalDuplicateNeverBecomesTeamAndKeysRemainStable() {
        val json = """{"type":"memory-provenance","turnKey":"turn","recalledTeamIds":["same","team","team"],"fetchedPersonalIds":["same"],"labels":{"same":"Secret","team":"Team guide"}}"""
        val row = recall(json)
        assertEquals(2, row.entries.size)
        assertEquals("personal", row.entries.first { it.id == "same" }.scope)
        assertEquals("Details unavailable", row.entries.first { it.id == "same" }.label)
        assertEquals(row.id, recall(json).id)
    }

    @Test fun countOnlyRecallHasNoEntries() {
        val row = recall("""{"type":"memory-provenance","fetchedIds":["one","two"]}""")
        assertEquals(2, row.fetched)
        assertTrue(row.entries.isEmpty())
    }
    @Test fun recallExpansionRequiresSuccessfulCurrentTeamAccess() {
        val row = ChatRow.MemoryRecall("row", listOf(ChatRow.MemoryEntry("t", "Team guide", "team"),
            ChatRow.MemoryEntry("p", "Private secret", "personal"), ChatRow.MemoryEntry("u", "Unknown secret", "unknown")), 3)
        val access = MemoryRecallAccess(true, true, "A", "A")
        assertEquals(listOf("Team guide"), row.visibleTeamLabels(access))
        assertTrue(row.visibleTeamLabels(access.copy(loaded = false)).isEmpty())
        assertTrue(row.visibleTeamLabels(access.copy(allowed = false)).isEmpty())
        assertTrue(row.visibleTeamLabels(access.copy(selectedTeamId = "B")).isEmpty())
        val duplicate = row.copy(entries = row.entries + ChatRow.MemoryEntry("t", "Hidden duplicate", "unknown"))
        assertTrue(duplicate.visibleTeamLabels(access).isEmpty())
    }
}
