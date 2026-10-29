package ai.nuphos.android

import ai.nuphos.android.data.*
import ai.nuphos.android.model.*
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class AgentTranscriptParityTest {
    private val start = Instant.parse("2026-10-26T00:00:00Z")
    private fun reply(id: String, seconds: Long) = ChatMessage(id = id, role = ChatMessage.Role.Assistant,
        createdAt = start.plusSeconds(seconds), parts = listOf(ChatPart.Text(text = "Reply $id")))
    private fun group(id: String, seconds: Long) = TransferDownloadGroup(id, "2030-01-01T00:00:00Z",
        listOf(TransferDownloadFile("file", "report.txt", "ready")), start.plusSeconds(seconds).toString())

    @Test fun downloadsAnchorToTheFirstFollowingReplyAndFallBackToTheLatest() {
        val messages = listOf(reply("one", 10), reply("two", 20))
        val groups = listOf(group("a", 5), group("b", 10), group("c", 11), group("d", 25))
        val anchors = AgentDownloads.anchor(groups, messages)
        assertEquals(listOf("a", "b"), anchors.getValue("one").map { it.groupId })
        assertEquals(listOf("c", "d"), anchors.getValue("two").map { it.groupId })
        assertTrue(AgentDownloads.anchor(groups, emptyList()).isEmpty())
    }

    @Test fun downloadRowsStayOutsideFoldedToolWork() {
        val rows = ChatRow.rows(listOf(reply("one", 10)), downloads = listOf(group("a", 5)))
        val text = rows.indexOfFirst { it is ChatRow.AssistantText }
        val download = rows.indexOfFirst { it is ChatRow.Downloads }
        assertTrue(download > text)
        assertEquals(1, rows.filterIsInstance<ChatRow.Downloads>().size)
    }

    @Test fun timelineDoesNotInventEventsForUnloadedEarlierPages() {
        val earlier = AgentConversationDetail.TimelineEvent(start.plusSeconds(1), "Joined")
        val between = AgentConversationDetail.TimelineEvent(start.plusSeconds(15), "Runtime changed")
        val rows = ChatRow.rows(listOf(reply("one", 10), reply("two", 20)), timeline = listOf(between, earlier), hasEarlier = true)
        assertFalse(rows.filterIsInstance<ChatRow.Hint>().any { it.text == "Joined" })
        assertTrue(rows.filterIsInstance<ChatRow.Hint>().any { it.text == "Runtime changed" })
    }

    @Test fun successfulThreadReceiptsBecomeLinksButErrorsAndNonUUIDsDoNot() {
        val id = "11111111-1111-4111-8111-111111111111"
        val part = ChatPart.Tool("call", "create_thread", false, ChatPart.Tool.State.OutputAvailable,
            output = JsonValue.parse("""[{"type":"text","text":"{\"threadId\":\"$id\"}"}]"""))
        assertEquals(id, ThreadReference.from(part)?.id)
        assertNull(ThreadReference.from(part.copy(state = ChatPart.Tool.State.OutputError)))
        assertNull(ThreadReference.from(part.copy(output = JsonValue.parse("""{"threadId":"../foreign"}"""))))
    }

    @Test fun successfulThreadCardsStayVisibleOutsideOrdinaryToolWork() {
        val normal = ChatPart.Tool("read-one", "Terminal", false, ChatPart.Tool.State.OutputAvailable)
        val thread = ChatPart.Tool("child", "create_thread", false, ChatPart.Tool.State.OutputAvailable,
            output = JsonValue.parse("""{"threadId":"44444444-4444-4444-8444-444444444444"}"""))
        val message = reply("one", 10).copy(parts = listOf(normal, normal.copy(toolCallId = "read-two"), thread, ChatPart.Text(text = "Finished")))
        val rows = ChatRow.rows(listOf(message))
        assertEquals(1, rows.filterIsInstance<ChatRow.Tool>().count { ThreadReference.from(it.part) != null })
        val work = rows.filterIsInstance<ChatRow.Work>().single()
        assertEquals(2, work.rows.size)
        assertFalse(work.rows.filterIsInstance<ChatRow.Tool>().any { ThreadReference.from(it.part) != null })
    }

    @Test fun expiredAndMismatchedDownloadGroupsAreRejected() {
        assertTrue(runCatching { group("a", 1).copy(expiresAt = "2000-01-01T00:00:00Z").readyFiles("a") }.isFailure)
        assertTrue(runCatching { group("a", 1).readyFiles("other") }.isFailure)
    }
}
