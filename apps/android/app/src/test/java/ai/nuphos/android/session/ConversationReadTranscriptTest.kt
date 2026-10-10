package ai.nuphos.android.session

import ai.nuphos.android.data.ConversationReadApi
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.ChatPart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ConversationReadTranscriptTest {
    @Before fun setup() { Dispatchers.setMain(UnconfinedTestDispatcher()) }
    @After fun cleanup() { Dispatchers.resetMain() }
    private fun detail(owner: Boolean? = true, first: Int = 0) = AgentConversationDetail(
        isOwner = owner, messagesFirstIndex = first, activitySeq = JsonValue.Number(4.0),
        messages = listOf(ChatMessage(id = "saved", parts = listOf(ChatPart.Text(text = "shown")))))
    @Test fun onlySuccessfulExplicitOwnerFullTranscriptCreatesMarker() = runTest {
        for (value in listOf(detail(), detail(false), detail(null), detail(first = 2))) {
            val session = ChatSession("fixture", "team", browsingOnly = true, aiAllowed = { true }, readDetail = { _, _, _ -> value })
            session.load()
            assertNull(session.readTranscript)
            session.disposeForConsent()
        }
        val owner = ChatSession("fixture", "team", aiAllowed = { true }, readDetail = { _, _, _ -> detail() })
        val value = detail()
        @Suppress("UNCHECKED_CAST")
        val state = ChatSession::class.java.getDeclaredField("messages\$delegate").also { it.isAccessible = true }.get(owner) as androidx.compose.runtime.MutableState<List<ChatMessage>>
        state.value = value.messages
        ChatSession::class.java.getDeclaredMethod("recordReadTranscript", AgentConversationDetail::class.java).also { it.isAccessible = true }.invoke(owner, value)
        assertEquals(4L, owner.readTranscript?.seq)
        assertEquals(owner.messages, owner.readTranscript?.messages)
        val record = ChatSession::class.java.getDeclaredMethod("recordReadTranscript", AgentConversationDetail::class.java).also { it.isAccessible = true }
        for (rejected in listOf(value.copy(isOwner = false), value.copy(isOwner = null), value.copy(messagesFirstIndex = 2, activeRun = AgentConversationDetail.ActiveRun("running")), value.copy(activitySeq = JsonValue.Number(5.5)), value.copy(messages = emptyList()))) {
            record.invoke(owner, rejected)
            assertNull(owner.readTranscript)
        }
        record.invoke(owner, value.copy(messagesFirstIndex = 100))
        assertEquals(4L, owner.readTranscript?.seq)
        owner.disposeForConsent()
        assertNull(owner.readTranscript)
    }
    @Test fun failedLoadNeverCreatesMarkerDespiteDefaultOwner() = runTest {
        val session = ChatSession("fixture", "team", aiAllowed = { true }, readDetail = { _, _, _ -> error("failed") })
        session.load()
        assertNull(session.readTranscript)
        assertFalse(session.readAllowed)
        session.disposeForConsent()
    }
    @Test fun payloadCarriesSafeObservedSequenceAndExactTeam() {
        val payload = ConversationReadApi.payload("team-a", 9007199254740991L)
        assertEquals("team-a", payload["teamId"]?.stringValue)
        assertEquals(9007199254740991.0, payload["seq"]?.numberValue)
        assertThrows(IllegalArgumentException::class.java) { ConversationReadApi.payload("team-b", -1) }
        val reads = ConversationReads()
        val target = ConversationReads.Target("a", "team-a", "s")
        reads.visible(target)
        val ticket = reads.begin(target, 1, 4)!!
        assertFalse(reads.accepts(ticket, target.copy(sessionId = "other"), 1, true))
        assertFalse(reads.accepts(ticket, target, 2, true))
        assertFalse(reads.accepts(ticket, target, 1, false))
    }
}
