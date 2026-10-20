package ai.nuphos.android.session

import ai.nuphos.android.data.AgentRuntime
import ai.nuphos.android.data.RuntimeBinding
import ai.nuphos.android.model.AgentConversationDetail
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ModelSettingsSessionTest {
    private val opened = mutableListOf<ChatSession>()
    @org.junit.Before fun setup() { Dispatchers.setMain(UnconfinedTestDispatcher()) }
    @org.junit.After fun cleanup() {
        kotlinx.coroutines.runBlocking {
            opened.forEach { session ->
                session.disposeForConsent()
                val field = ChatSession::class.java.getDeclaredField("scope").also { it.isAccessible = true }
                (field.get(session) as kotlinx.coroutines.CoroutineScope).coroutineContext[kotlinx.coroutines.Job]?.join()
            }
        }
        Dispatchers.resetMain()
    }
    @Test fun switchingAgentProviderResetsModelCapabilityAndInvalidatesOldStore() = runTest {
        var runtime = "old"
        var provider = "codex"
        val session = ChatSession("synthetic", "team", sessionId = "chat", aiAllowed = { true }, readDetail = { _, _, _ ->
            AgentConversationDetail(runtimeId = runtime, agentRuntime = provider, isOwner = true, canManage = true, readOnly = false, messages = emptyList())
        }, moveRuntime = { _, _, _, target, _ ->
            runtime = target.id; provider = target.provider; RuntimeBinding(runtime, provider)
        }).also { opened += it }
        session.activateModelSettings(true); session.load()
        val old = session.modelSettings!!
        old.restorePending(mapOf("model" to "old-provider-model"))
        session.moveAgent(AgentRuntime("new", "claude-code", "New", "active", "managed"))
        assertEquals("new", session.runtimeId); assertEquals("claude-code", session.agentRuntime)
        assertNotSame(old, session.modelSettings); assertNull(old.config); assertFalse(old.canEdit)
        assertTrue(session.modelSettings!!.pending.isEmpty())
        session.disposeForConsent(); assertNull(session.modelSettings)
    }
    @Test fun switchingSessionScopeCannotReusePreviousCapability() = runTest {
        val session = ChatSession("synthetic", "team", sessionId = "chat", aiAllowed = { true }, readDetail = { _, _, _ ->
            AgentConversationDetail(runtimeId = "r", agentRuntime = "codex", isOwner = true, messages = emptyList())
        }).also { opened += it }
        session.load(); session.activateModelSettings(true)
        val old = session.modelSettings!!
        old.restorePending(mapOf("model" to "b"))
        session.activateModelSettings(false); assertNull(session.modelSettings); assertFalse(old.canEdit)
        session.activateModelSettings(true); assertNotSame(old, session.modelSettings)
        assertEquals(mapOf("model" to "b"), session.modelSettings!!.pending)
        session.disposeForConsent()
    }
    @Test fun workspaceAwayAndBackRejectsPreviousCapabilityBeforeScreenDisposal() = runTest {
        var workspaceRevision = 1L
        val session = ChatSession("synthetic", "team", sessionId = "chat", aiAllowed = { true }, readDetail = { _, _, _ ->
            AgentConversationDetail(runtimeId = "r", agentRuntime = "codex", isOwner = true, messages = emptyList())
        }).also { opened += it }
        session.load()
        session.activateModelSettings(true) { workspaceRevision == 1L }
        val previous = session.modelSettings!!
        previous.restorePending(mapOf("model" to "b"))
        workspaceRevision = 3L // Away and back, even to the same workspace ID.
        assertFalse(previous.canStart)
        session.activateModelSettings(true) { workspaceRevision == 3L }
        assertNotSame(previous, session.modelSettings)
        session.disposeForConsent()
    }

}
