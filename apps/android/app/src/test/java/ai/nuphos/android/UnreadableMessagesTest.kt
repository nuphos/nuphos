package ai.nuphos.android

import ai.nuphos.android.data.Http
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.ChatPart
import kotlinx.serialization.SerializationException
import org.junit.Assert.*
import org.junit.Test

class UnreadableMessagesTest {
    private val first = """{"id":"first","role":"user","parts":[{"type":"text","text":"Hello"}]}"""
    private val last = """{"id":"last","role":"assistant","parts":[{"type":"text","text":"Hi"}]}"""
    private fun ids(json: String) = Http.json.decodeFromString<AgentConversationDetail>(json).messages.map { it.id }

    @Test fun anUnreadableMessageIsSkippedAndTheRestKeepTheirOrder() {
        for (bad in listOf(
            """{"role":"user","parts":[]}""",
            """{"id":"","role":"user","parts":[]}""",
            """{"id":5,"role":"user","parts":[]}""",
            """{"id":"x","role":"robot","parts":[{"type":"text","text":"Not from an agent"}]}""",
            """{"id":"x","parts":[]}""",
            """{"id":"x","role":{},"parts":[]}""",
            "\"text\"", "3", "null", "[]",
        )) assertEquals(bad, listOf("first", "last"), ids("""{"messages":[$first,$bad,$last]}"""))
    }
    @Test fun everyKnownRoleIsKept() {
        val messages = Http.json.decodeFromString<AgentConversationDetail>("""{"messages":[
            {"id":"u","role":"user"},{"id":"a","role":"assistant"},{"id":"s","role":"system"}]}""").messages
        assertEquals(listOf(ChatMessage.Role.User, ChatMessage.Role.Assistant, ChatMessage.Role.System), messages.map { it.role })
    }
    @Test fun aMessagesProblemsBelowTheMessageDoNotCostItItsPlace() {
        // Parts and dates were already tolerant, and stay that way.
        assertEquals(listOf("x"), ids("""{"messages":[{"id":"x","role":"user","parts":"oops","createdAt":"nope","metadata":"x"}]}"""))
        val message = Http.json.decodeFromString<AgentConversationDetail>("""{"messages":[{"id":"x","role":"user","parts":[3]}]}""").messages.single()
        assertTrue(message.parts.single() is ChatPart.Other)
    }
    @Test fun nothingOrNoMessagesStillDecode() {
        assertEquals(emptyList<String>(), ids("{}"))
        assertEquals(emptyList<String>(), ids("""{"messages":[]}"""))
        assertEquals(listOf("first"), ids("""{"messages":[$first],"future":1}"""))
    }
    @Test fun messagesThatAreNotAListAreStillAFailure() {
        assertThrows(SerializationException::class.java) { ids("""{"messages":"oops"}""") }
    }
    @Test fun aDetailStillRoundTrips() {
        val detail = AgentConversationDetail(messages = listOf(ChatMessage(id = "x", role = ChatMessage.Role.User, parts = listOf(ChatPart.Text(text = "Hello")))))
        val again = Http.json.decodeFromString<AgentConversationDetail>(Http.json.encodeToString(AgentConversationDetail.serializer(), detail))
        assertEquals("Hello", again.messages.single().text)
        assertEquals("x", again.messages.single().id)
    }
}
