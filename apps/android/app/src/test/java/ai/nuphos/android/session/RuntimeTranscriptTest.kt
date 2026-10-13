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
}
