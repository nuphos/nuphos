package ai.nuphos.android

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.ChatPart
import ai.nuphos.android.model.ChatRow
import ai.nuphos.android.ui.chat.MemoryRecallAccess
import ai.nuphos.android.ui.chat.visibleTeamLabels
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
    @Test fun adjacentCallsKeepChronologyNamesAndStableRunKey() {
        val parts = listOf(ChatPart.Reasoning(text = "Before"), tool("one"), ChatPart.Reasoning(text = "Between"), tool("two"))
        val message = ChatMessage(id = "run", parts = parts)
        val single = ChatRow.rows(listOf(message.copy(parts = parts.take(2))), isStreaming = true).filterIsInstance<ChatRow.Tool>().single()
        val grouped = ChatRow.rows(listOf(message), isStreaming = true).filterIsInstance<ChatRow.ToolRun>().single()
        assertEquals(single.id, grouped.id)
        assertEquals(listOf("one", "two"), grouped.rows.filterIsInstance<ChatRow.Tool>().map { it.part.toolCallId })
        assertEquals(listOf("Between"), grouped.rows.filterIsInstance<ChatRow.Reasoning>().map { it.part.text })
        assertTrue(grouped.live)
        val updated = message.copy(parts = parts.dropLast(1) + tool("two").copy(state = ChatPart.Tool.State.OutputError))
        assertEquals(grouped.id, ChatRow.rows(listOf(updated), isStreaming = true).filterIsInstance<ChatRow.ToolRun>().single().id)
        assertEquals(grouped.id, ChatRow.rows(listOf(message)).filterIsInstance<ChatRow.ToolRun>().single().id)
    }

    @Test fun narrationAndInteractiveToolsSplitRunsWithoutLosingCalls() {
        val question = tool("question").copy(toolName = "request_user_decision", input = JsonValue.obj())
        val plan = tool("plan").copy(toolName = "plan_create")
        val parts = listOf(tool("a"), tool("b"), ChatPart.Text(text = "Narration"),
            tool("c"), question, tool("d"), plan, tool("e"), tool("f"))
        val rows = ChatRow.rows(listOf(ChatMessage(id = "boundaries", parts = parts)), isStreaming = true)
        assertEquals(2, rows.filterIsInstance<ChatRow.ToolRun>().size)
        assertTrue(rows.any { it is ChatRow.AssistantText && it.text == "Narration" })
        assertEquals(listOf("c", "question", "d", "plan"), rows.filterIsInstance<ChatRow.Tool>().map { it.part.toolCallId })
    }

    @Test fun completedWorkKeepsOriginalStepCountAndPendingApprovalIsNotFolded() {
        val parts = listOf(tool("a"), ChatPart.Reasoning(text = "Between"), tool("b"), ChatPart.Text(text = "Final"))
        val finished = ChatRow.rows(listOf(ChatMessage(id = "complete", parts = parts)))
        val work = finished.filterIsInstance<ChatRow.Work>().single()
        assertEquals(3, work.rows.size)
        assertEquals(1, ChatRow.toolRuns(work.rows, live = false).filterIsInstance<ChatRow.ToolRun>().size)
        assertEquals("Final", finished.filterIsInstance<ChatRow.AssistantText>().single().text)
        val pending = parts.take(2) + tool("b").copy(state = ChatPart.Tool.State.ApprovalRequested) + parts.last()
        val row = ChatRow.rows(listOf(ChatMessage(id = "pending", parts = pending))).filterIsInstance<ChatRow.ToolRun>().single()
        assertTrue(row.rows.filterIsInstance<ChatRow.Tool>().last().canDecide)
    }

    @Test fun streamedReplayUpdatesSameCallsAndHistoryKeepsTheirRun() {
        val reducer = ai.nuphos.android.session.UIStreamReducer(ChatMessage(id = "streamed", parts = emptyList()))
        fun frame(value: String) { reducer.apply(JsonValue.parse(value)!!) }
        frame("""{"type":"tool-input-available","toolCallId":"a","toolName":"terminal","input":{"command":"echo display"}}""")
        frame("""{"type":"tool-output-available","toolCallId":"a","output":"done"}""")
        frame("""{"type":"tool-input-available","toolCallId":"b","toolName":"terminal","input":{"command":"echo display"}}""")
        val first = ChatRow.rows(listOf(reducer.message), isStreaming = true).filterIsInstance<ChatRow.ToolRun>().single()
        frame("""{"type":"tool-input-available","toolCallId":"b","toolName":"terminal","input":{"command":"echo display"}}""")
        frame("""{"type":"tool-approval-request","toolCallId":"b","approvalId":"approval"}""")
        val pending = ChatRow.rows(listOf(reducer.message), isStreaming = true).filterIsInstance<ChatRow.ToolRun>().single()
        assertEquals(first.id, pending.id)
        assertEquals(listOf("a", "b"), pending.rows.filterIsInstance<ChatRow.Tool>().map { it.part.toolCallId })
        assertTrue(pending.rows.filterIsInstance<ChatRow.Tool>().last().canDecide)
        frame("""{"type":"tool-output-error","toolCallId":"b","errorText":"display failure"}""")
        val liveFailure = ChatRow.rows(listOf(reducer.message), isStreaming = true).filterIsInstance<ChatRow.ToolRun>().single()
        frame("""{"type":"text-start","id":"final"}""")
        frame("""{"type":"text-delta","id":"final","delta":"Final narration"}""")
        frame("""{"type":"text-end","id":"final"}""")
        val finished = ChatRow.rows(listOf(reducer.message))
        assertTrue(finished.none { it is ChatRow.Work })
        assertEquals("Final narration", finished.filterIsInstance<ChatRow.AssistantText>().single().text)
        val history = finished.filterIsInstance<ChatRow.ToolRun>().single()
        assertEquals(liveFailure.id, history.id)
        assertEquals(pending.id, history.id)
        assertEquals(ChatPart.Tool.State.OutputError, history.rows.filterIsInstance<ChatRow.Tool>().last().part.state)
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

    @Test fun aRuntimeStatusIsTheLastRowAndOutranksThePhase() {
        val rows = ChatRow.rows(emptyList(), phaseLabel = "Thinking", runtimeStatus = "Running tools", runtimeTurnActive = true)
        val activity = rows.filterIsInstance<ChatRow.Activity>().single()
        assertEquals("Running tools", activity.text)
        assertTrue(activity.live)
        assertEquals(ChatRow.Bottom, rows.last())
        assertEquals(activity, rows[rows.lastIndex - 1])
    }
    @Test fun anIdleRuntimeStatusIsntLive() {
        val activity = ChatRow.rows(emptyList(), runtimeStatus = "Completed").filterIsInstance<ChatRow.Activity>().single()
        assertFalse(activity.live)
    }
    @Test fun aRequestedCancelFollowsTheStatus() {
        val rows = ChatRow.rows(emptyList(), runtimeStatus = "Running tools", runtimeTurnActive = true, cancelRequested = true)
        val hint = rows.filterIsInstance<ChatRow.Hint>().single()
        assertEquals("Cancellation requested", hint.text)
        assertTrue(rows.indexOf(hint) > rows.indexOfFirst { it is ChatRow.Activity })
    }
}
