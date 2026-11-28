package ai.nuphos.android.session

import ai.nuphos.android.data.SseClient
import ai.nuphos.android.data.SseEvent
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ChatMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*

/**
 * #5266: a conversation can go on naming a run whose stream is over. Attaching to it once is
 * enough; neither the idle poll nor a reload attaches to it again. A failed attach says
 * nothing about the run, so the poll still attaches to it again.
 */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class EndedRunTest {
    @Before fun setup() { AiAccess.activate("fixture-ended"); AiAccess.grant("fixture-ended") }
    @After fun cleanup() { AiAccess.revoke(); Dispatchers.resetMain() }

    private val stored = listOf(
        ChatMessage.user("Question").copy(id = "u1"),
        ChatMessage.user("Stored reply").copy(id = "a1", role = ChatMessage.Role.Assistant),
    )
    private val detail = AgentConversationDetail(isOwner = true, messages = stored,
        activeRun = AgentConversationDetail.ActiveRun("run-over"))

    private fun sse(vararg frames: String): Flow<SseEvent> = flowOf(*frames.map { SseEvent(data = it) }.toTypedArray())

    private fun answer(kind: String, attach: Int): Flow<SseEvent> = when (kind) {
        "not-resumable" -> flow { throw SseClient.Failure.BadStatus(409, NOT_RESUMABLE, NOT_RESUMABLE) }
        // A failure that says nothing about the run: it may still be live.
        "unavailable" -> if (attach == 1) flow { throw SseClient.Failure.BadStatus(500, FAILURE, FAILURE) } else answer("unresumable", attach)
        "ended" -> sse("""{"type":"start","messageId":"a1"}""", """{"type":"text-start","id":"t"}""",
            """{"type":"text-delta","id":"t","delta":"Stored reply"}""", """{"type":"text-end","id":"t"}""",
            """{"type":"atlas-turn-complete"}""", """{"type":"atlas-stream-done"}""")
        else -> sse("""{"type":"error","errorCode":"stream_unresumable","errorText":"Agent run stream is no longer available"}""",
            """{"type":"atlas-stream-done"}""")
    }

    private fun TestScope.session(kind: String, attaches: IntArray) = ChatSession("fixture-ended", "team", kind,
        readBypass = { _, _ -> false }, aiAllowed = { true },
        readDetail = { _, _, _ -> detail },
        readEvents = { attaches[0] += 1; answer(kind, attaches[0]) })

    @Test fun aRunThatIsOverIsAttachedToOnce() = runTest {
        for (kind in listOf("unresumable", "not-resumable", "ended")) {
            Dispatchers.setMain(StandardTestDispatcher(testScheduler))
            val attaches = intArrayOf(0)
            val chat = session(kind, attaches)
            chat.load()
            val poll = launch { chat.pollWhileIdle() }
            advanceTimeBy(10_000); runCurrent()
            poll.cancel()
            // Reopened: the reload does not attach to it either.
            chat.load()
            val again = launch { chat.pollWhileIdle() }
            advanceTimeBy(7_000); runCurrent()
            again.cancel()
            assertEquals("$kind: attaches to the run that is over", 1, attaches[0])
            assertFalse("$kind: the chat still shows the run that is over as live", chat.isStreaming)
            assertEquals("$kind: the stored transcript is not shown", "Stored reply", chat.messages.lastOrNull()?.text)
            chat.disposeForConsent()
            AiAccess.activate("fixture-ended"); AiAccess.grant("fixture-ended")
        }
    }

    @Test fun aFailedAttachIsNotARunThatIsOver() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val attaches = intArrayOf(0)
        val chat = session("unavailable", attaches)
        chat.load()
        val poll = launch { chat.pollWhileIdle() }
        advanceTimeBy(10_000); runCurrent()
        poll.cancel()
        assertEquals("attaches again after a failed attach, then once", 2, attaches[0])
        chat.disposeForConsent()
    }

    private companion object {
        const val NOT_RESUMABLE = """{"error":{"code":"stream_not_resumable","message":"The agent stream is no longer resumable"}}"""
        const val FAILURE = """{"error":{"message":"Synthetic failure"}}"""
    }
}
