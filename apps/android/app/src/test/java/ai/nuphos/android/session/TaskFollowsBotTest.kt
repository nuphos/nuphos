package ai.nuphos.android.session

import ai.nuphos.android.model.AgentConversationDetail
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class TaskFollowsBotTest {
    @Before fun setup() { Dispatchers.setMain(UnconfinedTestDispatcher()) }
    @After fun cleanup() { Dispatchers.resetMain() }

    private val json = Json { ignoreUnknownKeys = true }

    private suspend fun followsBot(body: String): Boolean {
        val detail = json.decodeFromString<AgentConversationDetail>(body)
        val session = ChatSession("fixture", "team", readBypass = { _, _ -> false }, aiAllowed = { true },
            readDetail = { _, _, _ -> detail })
        session.load()
        return session.followsBot.also { session.disposeForConsent() }
    }

    // The backend sends credentialSource only for a Task whose credentials, computers and mode are its Bot's.
    @Test fun taskUnderBotFollowsIt() = runTest {
        assertTrue(followsBot("""{"agentRuntime":"claude-code","credentialSource":{"sessionId":"bot"}}"""))
    }

    @Test fun conversationWithoutSourceKeepsItsOwnControls() = runTest {
        assertFalse(followsBot("""{"agentRuntime":"claude-code"}"""))
        assertFalse(followsBot("""{"agentRuntime":"claude-code","credentialSource":null}"""))
    }
}
