package ai.nuphos.android.session

import ai.nuphos.android.model.AgentConversationDetail
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*

/** #3526: back on a chat it already had, the app reads it again at once, not after 3 s. */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ChatRevalidateTest {
    @Before fun setup() { Dispatchers.setMain(UnconfinedTestDispatcher()) }
    @After fun cleanup() { Dispatchers.resetMain() }

    @Test fun backOnALoadedChatTheFirstReadIsAtOnce() = runTest {
        var reads = 0
        val session = ChatSession("fixture", "team", readBypass = { _, _ -> false }, aiAllowed = { true },
            readDetail = { _, _, _ -> reads++; AgentConversationDetail(isOwner = true, messages = emptyList()) })
        session.load()
        val loadedReads = reads
        val poll = launch { session.pollWhileIdle() }

        runCurrent()
        assertEquals("read once on return, before any wait", loadedReads + 1, reads)
        advanceTimeBy(2_999); runCurrent()
        assertEquals("then every 3 s", loadedReads + 1, reads)
        advanceTimeBy(2); runCurrent()
        assertEquals(loadedReads + 2, reads)
        poll.cancel()
    }
}
