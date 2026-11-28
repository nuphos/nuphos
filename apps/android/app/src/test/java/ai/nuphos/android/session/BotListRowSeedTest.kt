package ai.nuphos.android.session

import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.AgentConversationDetail
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

/** A Bot's details say what it runs from its list row, before its own read lands and if that read fails. */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class BotListRowSeedTest {
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
    private val row = AgentConversation(sessionId = "bot", title = "Release notes", avatar = "02-leonardo",
        agentRuntime = "claude-code", runtimeLabel = "Fixture Box", isOwner = true)

    @Test fun runtimeAndModelShowWhileTheBotsReadIsOnItsWay() = runTest {
        val held = CompletableDeferred<AgentConversationDetail>()
        val session = ChatSession("synthetic", "team", sessionId = "bot", aiAllowed = { true }, readDetail = { _, _, _ -> held.await() })
            .also { opened += it }
        session.seedFromListRow(row)
        val load = launch { session.load() }
        session.activateModelSettings(true)
        assertFalse("The Bot's read landed before the check", session.loaded)
        assertEquals("The runtime read as unset", "claude-code", session.agentRuntime)
        assertEquals("Fixture Box", session.runtimeDeviceLabel)
        assertTrue("The session does not know it is a Bot", session.isBot)
        assertNotNull("The Bot's model cannot be read while it loads", session.modelSettings)
        held.complete(AgentConversationDetail(runtimeId = "fixture-runtime", agentRuntime = "claude-code", runtimeLabel = "Fixture Box",
            avatar = "02-leonardo", isOwner = true, canManage = true, readOnly = false, messages = emptyList()))
        load.join()
        assertTrue(session.loaded)
        assertNotNull("The model is not read again once the Bot has loaded", session.modelSettings)
    }

    @Test fun runtimeAndModelShowWhenTheBotsReadFails() = runTest {
        val session = ChatSession("synthetic", "team", sessionId = "bot", aiAllowed = { true },
            readDetail = { _, _, _ -> throw IllegalStateException("internal") }).also { opened += it }
        session.seedFromListRow(row)
        session.load()
        session.activateModelSettings(true)
        assertNotNull("The fixture's read did not fail", session.loadError)
        assertEquals("The Bot's runtime is missing", "claude-code", session.agentRuntime)
        assertTrue("A Bot whose read failed is no longer known as a Bot", session.isBot)
        assertNotNull("The Bot's model never becomes readable", session.modelSettings)
    }

    @Test fun theBotsOwnReadReplacesTheRow() = runTest {
        val session = ChatSession("synthetic", "team", sessionId = "bot", aiAllowed = { true }, readDetail = { _, _, _ ->
            AgentConversationDetail(runtimeId = "moved", agentRuntime = "codex", runtimeLabel = "Other Box", avatar = "02-leonardo",
                isOwner = true, messages = emptyList())
        }).also { opened += it }
        session.seedFromListRow(row)
        session.activateModelSettings(true)
        val seeded = session.modelSettings
        session.load()
        assertEquals("codex", session.agentRuntime)
        assertEquals("Other Box", session.runtimeDeviceLabel)
        assertNotSame("The model read for the row's runtime outlived the Bot's read", seeded, session.modelSettings)
        session.seedFromListRow(row)
        assertEquals("A list row overrode the Bot's own read", "codex", session.agentRuntime)
    }
}
