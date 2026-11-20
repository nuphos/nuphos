package ai.nuphos.android

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.ChatPart
import ai.nuphos.android.model.ChatRow
import ai.nuphos.android.session.UIStreamReducer
import org.junit.Assert.*
import org.junit.Test

class FailedTurnTest {
    private fun failure(reason: String = "error", id: String = "failure") = ChatPart.Other(JsonValue.parse(
        """{"type":"turn-interrupted","id":"$id","reason":"$reason","message":"Synthetic provider failure","createdAt":"2026-11-19T03:00:00Z"}""")!!)
    private fun prompt(parts: List<ChatPart> = listOf(ChatPart.Text(text = " Please retry ")), metadata: JsonValue? = null) =
        ChatMessage("prompt", ChatMessage.Role.User, parts, metadata = metadata)
    private fun reply(part: ChatPart = failure()) = ChatMessage("reply", ChatMessage.Role.Assistant, listOf(part))

    @Test fun latestOwnTextPromptIsTrimmedAndMatchedToFailureRow() {
        val result = ChatRow.failedTurn(listOf(prompt(), reply()), "viewer", false)
        assertEquals(ChatRow.FailedTurn("interrupted.reply.failure", "Please retry"), result)
        assertNull(ChatRow.failedTurn(listOf(prompt(), reply(), prompt()), "viewer", false))
        assertNull(ChatRow.failedTurn(listOf(prompt(), reply(), reply(ChatPart.Text(text = "done"))), "viewer", false))
    }

    @Test fun teammateEventAndUnattributedForeignPromptNeverRetry() {
        fun metadata(sender: String, source: String = "nuphos") = JsonValue.parse("""{"source":"$source","sender":{"id":"$sender"}}""")!!
        assertNull(ChatRow.failedTurn(listOf(prompt(metadata = metadata("other")), reply()), "viewer", false))
        assertNull(ChatRow.failedTurn(listOf(prompt(metadata = metadata("viewer", "agent.resource")), reply()), "viewer", false))
        assertNull(ChatRow.failedTurn(listOf(prompt(), reply()), "viewer", true))
        assertNotNull(ChatRow.failedTurn(listOf(prompt(metadata = metadata("viewer")), reply()), "viewer", true))
    }

    @Test fun attachmentUnknownPartAndEmptyPromptNeverLoseTheirPayloadOnRetry() {
        for (parts in listOf(listOf(ChatPart.Text(text = " ")), listOf(ChatPart.Text(text = "text"), ChatPart.Other(JsonValue.obj("type" to JsonValue.Str("file")))), emptyList()))
            assertNull(ChatRow.failedTurn(listOf(prompt(parts), reply()), "viewer", false))
    }

    @Test fun cancelledLatestInterruptionNeverRetriesOrCopiesAReport() {
        val cancelled = reply(failure("cancelled"))
        assertNull(ChatRow.failedTurn(listOf(prompt(), cancelled), "viewer", false))
        assertNull(ChatRow.failureReport("interrupted.reply.failure", listOf(cancelled)))
        val two = reply().copy(parts = listOf(failure(), failure("cancelled", "cancelled")))
        assertNull(ChatRow.failedTurn(listOf(prompt(), two), "viewer", false))
    }

    @Test fun reportContainsLocalizedHeadlineExactErrorAndRecordedTime() {
        assertEquals("Turn failed.\nSynthetic provider failure\n2026-11-19T03:00:00Z",
            ChatRow.failureReport("interrupted.reply.failure", listOf(reply())))
        assertTrue(ChatRow.failureReport("interrupted.reply.failure", listOf(reply(failure("timeout"))))!!.startsWith("Turn timed out.\n"))
        assertNull(ChatRow.failureReport("different-row", listOf(reply())))
    }

    @Test fun malformedInterruptionIsIgnoredRatherThanCreatingRetryAction() {
        val raw = ChatPart.Other(JsonValue.parse("""{"type":"turn-interrupted","message":"missing id"}""")!!)
        assertNull(ChatRow.interruption(raw))
        assertNull(ChatRow.failedTurn(listOf(prompt(), reply(raw)), "viewer", false))
    }

    @Test fun repeatedStreamingFailureReplacesSameIdAndSurvivesReducerSnapshot() {
        val reducer = UIStreamReducer(ChatMessage("reply", parts = emptyList()))
        val raw = (failure() as ChatPart.Other).value
        reducer.apply(raw); reducer.apply(raw)
        assertEquals(1, reducer.message.parts.count { ChatRow.interruption(it) != null })
        assertNotNull(ChatRow.failureReport("interrupted.reply.failure", listOf(reducer.message)))
    }

    @Test fun persistedFailureIsVisibleOnceWhenStreamAlsoReportedSameError() {
        val rows = ChatRow.rows(listOf(prompt(), reply()), error = "Synthetic provider failure")
        assertEquals(1, rows.filterIsInstance<ChatRow.Hint>().count { it.isError })
        assertEquals("interrupted.reply.failure", rows.filterIsInstance<ChatRow.Hint>().single { it.isError }.id)
    }

    @Test fun olderFailureDoesNotHideNewUnrelatedStreamError() {
        val messages = listOf(prompt(), reply(), prompt(), reply(ChatPart.Text(text = "new work")))
        val rows = ChatRow.rows(messages, error = "Synthetic provider failure")
        assertTrue(rows.filterIsInstance<ChatRow.Hint>().any { it.id == "error" })
    }

    @Test fun cancellationReceiptAndLegacyStopFlagShowOneStoppedLine() {
        val stopped = reply(failure("cancelled")).copy(stoppedByUser = true)
        val hints = ChatRow.rows(listOf(prompt(), stopped)).filterIsInstance<ChatRow.Hint>()
        assertEquals(1, hints.size)
        assertFalse(hints.single().isError)
    }
}
