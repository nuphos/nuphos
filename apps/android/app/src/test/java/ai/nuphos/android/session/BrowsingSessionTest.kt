package ai.nuphos.android.session

import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ChatMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class BrowsingSessionTest {
    @Before fun setup() { Dispatchers.setMain(UnconfinedTestDispatcher()) }
    @After fun cleanup() { Dispatchers.resetMain() }

    @Test fun serverWritableMetadataAndQueuedPromptCannotMakeBrowsingWritable() = runTest {
        var reads = 0
        val message = ChatMessage(id = "saved", parts = emptyList())
        val session = ChatSession("fixture", "team", browsingOnly = true, aiAllowed = { true }, readDetail = { _, _, _ ->
            reads++
            AgentConversationDetail(messages = listOf(message), readOnly = false, isOwner = true,
                canCancelRun = true, canRespondToRun = true)
        })
        assertTrue(session.readOnly)
        session.sendAfterLoad = "Do not execute"
        session.load()
        session.reloadFromServer()
        session.pollWhileIdle()
        assertEquals(2, reads)
        assertEquals(listOf(message), session.messages)
        assertTrue(session.readOnly)
        assertFalse(session.canManage)
        assertFalse(session.canSubmit)
        assertFalse(session.canCancel)
        assertFalse(session.send("Do not execute"))
        assertFalse(session.recoverRuntime())
        assertFalse(session.retryQueued())
        assertNull(session.sendAfterLoad)
        session.disposeBrowsing()
    }
}
