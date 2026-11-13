package ai.nuphos.android.session

import ai.nuphos.android.model.ChatMessage
import org.junit.Assert.assertEquals
import org.junit.Test

class StreamGoneTest {
    private fun user(id: String) = ChatMessage(id = id, role = ChatMessage.Role.User, parts = emptyList())
    private fun reply(id: String) = ChatMessage(id = id, role = ChatMessage.Role.Assistant, parts = emptyList())
    private val earlier = listOf(user("u0"), reply("a0"))
    private val local = earlier + user("u1")

    @Test fun aReplyTheServerAlreadyStoredIsNotAskedForAgain() {
        assertEquals(StreamGone.Replied, StreamGone.decide(local + reply("a1"), null, "u1"))
    }

    @Test fun aRunStillLiveIsFollowed() {
        assertEquals(StreamGone.Follow("s2"), StreamGone.decide(local, "s2", "u1"))
    }

    @Test fun nothingAnsweringTheTurnSendsItAgain() {
        assertEquals(StreamGone.Resend, StreamGone.decide(local, null, "u1"))
        // The server never stored the question.
        assertEquals(StreamGone.Resend, StreamGone.decide(earlier, null, "u1"))
        // Even a reply already visible locally must never be requested twice.
        val shown = local + reply("a1")
        assertEquals(StreamGone.Replied, StreamGone.decide(shown, null, "u1"))
    }
}
