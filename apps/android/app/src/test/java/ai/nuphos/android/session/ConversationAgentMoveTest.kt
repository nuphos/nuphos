package ai.nuphos.android.session

import ai.nuphos.android.data.*
import ai.nuphos.android.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ConversationAgentMoveTest {
    @Before fun setup() { Dispatchers.setMain(UnconfinedTestDispatcher()) }
    @After fun cleanup() { Dispatchers.resetMain() }
    private val target = AgentRuntime("new", "codex", "New", "active", "external")
    private fun detail(owner: Boolean = true, manage: Boolean? = null, busy: Boolean = false) = AgentConversationDetail(
        isOwner = owner, canManage = manage, runtimeId = "old", agentRuntime = "codex", runtimeLabel = "Old",
        activeRun = if (busy) AgentConversationDetail.ActiveRun("busy") else null,
        messages = listOf(ChatMessage(id = "history", parts = listOf(ChatPart.Text(text = "Retained history")))))
    @Test fun onlyTheOwnerMovesAndFailurePreservesIdentityAndHistory() = runTest {
        // The server moves a conversation only for its owner, whoever else manages it.
        val managed = ChatSession("fixture", "team", readBypass = { _, _ -> false }, aiAllowed = { true },
            readDetail = { _, _, _ -> detail(owner = false, manage = true) }, moveRuntime = { _, _, _, _ -> fail("Not the owner") })
        managed.load()
        for (kind in listOf("local", "external")) {
            try { managed.moveAgent(target.copy(kind = kind)); fail("Teammate denied") } catch (_: IllegalArgumentException) {}
        }
        managed.disposeForConsent()
        val saved = detail()
        var calls = 0
        val session = ChatSession("fixture", "team", readBypass = { _, _ -> false }, aiAllowed = { true }, readDetail = { _, _, _ -> saved },
            moveRuntime = { _, _, _, _ -> calls++; throw IllegalStateException("Unavailable") })
        session.load()
        assertTrue(session.canMoveAgent)
        val before = session.messages
        try { session.moveAgent(target); fail("Failure expected") } catch (_: IllegalStateException) {}
        assertEquals(1, calls)
        assertEquals("old", session.runtimeId)
        assertEquals("Old", session.runtimeDeviceLabel)
        assertEquals(before, session.messages)
        assertFalse(session.movingAgent)
        session.disposeForConsent()
    }
    @Test fun activeRunBlocksMovesEvenWithoutLocalStreaming() = runTest {
        val session = ChatSession("fixture", "team", readBypass = { _, _ -> false }, aiAllowed = { true }, readDetail = { _, _, _ -> detail() })
        session.load()
        ChatSession::class.java.getDeclaredMethod("refreshMetadata", AgentConversationDetail::class.java, Double::class.javaPrimitiveType, Long::class.javaPrimitiveType)
            .also { it.isAccessible = true }.invoke(session, detail(busy = true), RuntimeObservation.now(), 0L)
        assertFalse(session.canMoveAgent)
        session.disposeForConsent()
    }
    @Test fun memberAndExplicitlyDeniedOwnerCannotMove() = runTest {
        for (saved in listOf(detail(false), detail(true, false))) {
            val session = ChatSession("fixture", "team", readBypass = { _, _ -> false }, aiAllowed = { true }, readDetail = { _, _, _ -> saved })
            assertFalse(session.canMoveAgent)
            session.load()
            assertFalse(session.canMoveAgent)
            session.disposeForConsent()
        }
    }
    @Test fun successfulMovePreservesHistoryAndBlocksSubmissionDuringRequest() = runTest {
        var saved = detail()
        lateinit var session: ChatSession
        session = ChatSession("fixture", "team", readBypass = { _, _ -> false }, aiAllowed = { true }, readDetail = { _, _, _ -> saved },
            moveRuntime = { _, _, _, _ ->
                assertTrue(session.movingAgent)
                assertFalse(session.canMoveAgent)
                assertFalse(session.canSubmit)
                saved = saved.copy(runtimeId = "new", runtimeLabel = "New")
                RuntimeBinding("new", "codex", "New")
            })
        session.load()
        val before = session.messages
        session.moveAgent(target)
        assertEquals("new", session.runtimeId)
        assertEquals(before, session.messages)
        assertFalse(session.movingAgent)
        session.disposeForConsent()
    }
}
