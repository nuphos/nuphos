package ai.nuphos.android.session

import ai.nuphos.android.model.AgentConversationDetail
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** #3526: a turn started elsewhere is followed only while its chat is on screen. */
@OptIn(ExperimentalCoroutinesApi::class)
class FollowOnLeaveTest {
    @Test fun leavingTheChatStopsFollowingATurnStartedElsewhere() = runBlocking {
        Dispatchers.setMain(Dispatchers.Unconfined)
        AiAccess.activate("synthetic-follow"); AiAccess.grant("synthetic-follow")
        val streams = AtomicInteger()
        val ended = CompletableDeferred<Unit>()
        val detail = AgentConversationDetail(isOwner = true, activeRun = AgentConversationDetail.ActiveRun("elsewhere"))
        val chat = ChatSession("synthetic-follow", "team", readBypass = { _, _ -> false }, aiAllowed = { true },
            readDetail = { _, _, _ -> detail },
            readEvents = { flow { streams.incrementAndGet(); try { awaitCancellation() } finally { ended.complete(Unit) } } })
        try {
            chat.load()
            withTimeout(5_000) { while (!chat.isStreaming || streams.get() == 0) delay(10) }
            val onScreen = launch { chat.pollWhileIdle() }

            delay(50)
            onScreen.cancelAndJoin()
            withTimeout(5_000) { ended.await() }
            assertFalse("no longer following once the chat left the screen", chat.isStreaming)
        } finally {
            chat.disposeForConsent(); AiAccess.revoke(); Dispatchers.resetMain()
        }
    }
}
