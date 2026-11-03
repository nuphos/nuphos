package ai.nuphos.android.session

import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.ChatPart
import org.junit.Assert.*
import org.junit.Test

class RuntimeTranscriptTest {
    @Test fun userAndAutonomousFramesReplayOnce() {
        val user = ChatMessage(id = "u", role = ChatMessage.Role.User, parts = emptyList())
        var messages = RuntimeTranscript.userTurn(listOf(user), emptyList())
        messages = RuntimeTranscript.autonomous("a", messages)
        messages = RuntimeTranscript.userTurn(listOf(user), messages)
        messages = RuntimeTranscript.autonomous("a", messages)
        messages = RuntimeTranscript.autonomous("a", messages)
        assertEquals(listOf("u", "a"), messages.map { it.id })
    }
    @Test fun receiptReplayKeepsOriginalTurn() {
        var messages = RuntimeTranscript.autonomous("a", emptyList())
        messages = RuntimeTranscript.steering("receipt", "first", "a", messages)
        messages = RuntimeTranscript.autonomous("b", messages)
        messages = RuntimeTranscript.steering("receipt", "first", "b", messages)
        assertEquals(1, messages[0].parts.filterIsInstance<ChatPart.Data>().size)
        assertTrue(messages[1].parts.isEmpty())
        assertEquals(messages, RuntimeTranscript.steering("late", "text", "missing", messages))
    }
    private fun sender(name: String = "Morgan") = ai.nuphos.android.data.JsonValue.parse("""{"version":1,"source":"nuphos","sentAt":"2026-11-02T00:00:00Z","sender":{"id":"morgan","type":"user","displayName":"$name"}}""")!!

    @Test fun acknowledgementAndStreamEitherOrderFillSenderWithoutChangingReceiptText() {
        for (streamFirst in listOf(false, true)) {
            var messages = RuntimeTranscript.autonomous("a", emptyList())
            messages = RuntimeTranscript.steering("s", "Keep the original text", "a", messages, if (streamFirst) sender() else null)
            messages = RuntimeTranscript.steering("s", "Conflicting replay", "a", messages, if (streamFirst) null else sender())
            messages = RuntimeTranscript.steering("s", "Another replay", "a", messages, sender("Other"))
            val receipt = messages.single().parts.filterIsInstance<ChatPart.Data>().single()
            assertEquals("Keep the original text", receipt.data["text"]?.stringValue)
            assertEquals("Morgan", ai.nuphos.android.model.MessageAttribution.parse(receipt.data["metadata"])?.name)
            val rows = ai.nuphos.android.model.ChatRow.rows(messages).filterIsInstance<ai.nuphos.android.model.ChatRow.User>()
            assertEquals(1, rows.size)
            assertEquals("steering.s", rows.single().id)
            assertEquals("Morgan", rows.single().sender?.name)
        }
    }

    @Test fun replayedHistoryUsesVerifiedAttributionOnceAndNeverLocalFallback() {
        val plain = RuntimeTranscript.steering("s", "Keep callback coverage", "a", RuntimeTranscript.autonomous("a", emptyList()))
        val withSender = RuntimeTranscript.steering("s", "Keep callback coverage", "b", RuntimeTranscript.autonomous("b", emptyList()), sender())
        val rows = ai.nuphos.android.model.ChatRow.rows(plain + withSender)
        assertEquals(1, rows.filterIsInstance<ai.nuphos.android.model.ChatRow.User>().size)
        assertEquals("Morgan", rows.filterIsInstance<ai.nuphos.android.model.ChatRow.User>().single().sender?.name)
        val unknown = ai.nuphos.android.model.ChatRow.rows(plain, localSender = { ai.nuphos.android.model.MessageAttribution("me", "Me", "user", "nuphos") })
        assertNull(unknown.filterIsInstance<ai.nuphos.android.model.ChatRow.User>().single().sender)
        val invalid = RuntimeTranscript.steering("s", "Keep callback coverage", "a", plain,
            ai.nuphos.android.data.JsonValue.parse(sender().compact.replace("user", "system")))
        assertNull(ai.nuphos.android.model.ChatRow.rows(invalid).filterIsInstance<ai.nuphos.android.model.ChatRow.User>().single().sender)
    }
}
