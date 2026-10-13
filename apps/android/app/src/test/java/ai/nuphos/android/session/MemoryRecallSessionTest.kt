package ai.nuphos.android.session

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ChatRow
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.ChatPart
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class MemoryRecallSessionTest {
    @Before fun setup() { Dispatchers.setMain(UnconfinedTestDispatcher()) }
    @After fun cleanup() { Dispatchers.resetMain() }
    private fun detail() = AgentConversationDetail(isOwner = false, messages = listOf(ChatMessage(id = "saved",
        parts = listOf(ChatPart.Other(JsonValue.parse("""{"type":"memory-provenance","turnKey":"one","recalledTeamIds":["team"]}""")!!)))))
    @Test fun sharedLoadedTranscriptAllowsRecallButFreshFailureAndDisposedDoNot() = runTest {
        var allowed = true
        var fail = false
        val session = ChatSession("fixture", "team", browsingOnly = true, aiAllowed = { allowed }, readDetail = { _, team, _ ->
            assertEquals("team", team)
            if (fail) error("denied") else detail()
        })
        val row = ChatRow.rows(detail().messages).filterIsInstance<ChatRow.MemoryRecall>().single()
        assertFalse(session.canShowRecall(row))
        session.load()
        assertTrue(session.canShowRecall(row))
        assertFalse(session.canShowRecall(row.copy(id = "recall.saved.new-stream-row")))
        assertFalse(session.canShowRecall(row.copy(entries = listOf(ChatRow.MemoryEntry("team", "Changed label", "team")))))
        assertNull(session.readTranscript)
        allowed = false
        assertFalse(session.canShowRecall(row))
        allowed = true
        fail = true
        session.load()
        assertFalse(session.canShowRecall(row))
        fail = false
        session.load()
        assertTrue(session.canShowRecall(row))
        session.disposeBrowsing()
        assertFalse(session.canShowRecall(row))
        session.disposeForConsent()
        assertFalse(session.canShowRecall(row))
    }
    @Test fun staleFailedReloadCannotClearNewerSuccessfulRecallWitness() = runTest {
        val release = CompletableDeferred<Unit>()
        val started = CompletableDeferred<Unit>()
        val session = ChatSession("fixture", "team", aiAllowed = { true }, readDetail = { _, _, _ ->
            started.complete(Unit)
            release.await()
            error("old failed read")
        })
        val value = detail()
        @Suppress("UNCHECKED_CAST")
        val messages = ChatSession::class.java.getDeclaredField("messages\$delegate").also { it.isAccessible = true }
            .get(session) as androidx.compose.runtime.MutableState<List<ChatMessage>>
        @Suppress("UNCHECKED_CAST")
        val loaded = ChatSession::class.java.getDeclaredField("loaded\$delegate").also { it.isAccessible = true }
            .get(session) as androidx.compose.runtime.MutableState<Boolean>
        val record = ChatSession::class.java.getDeclaredMethod("recordReadTranscript", AgentConversationDetail::class.java).also { it.isAccessible = true }
        messages.value = value.messages
        loaded.value = true
        record.invoke(session, value)
        val row = ChatRow.rows(value.messages).filterIsInstance<ChatRow.MemoryRecall>().single()
        val fetch = launch { session.reloadFromServer() }
        advanceTimeBy(400)
        runCurrent()
        started.await()
        val generation = ChatSession::class.java.getDeclaredField("transportGeneration").also { it.isAccessible = true }
        generation.setInt(session, generation.getInt(session) + 1)
        record.invoke(session, value)
        release.complete(Unit)
        fetch.join()
        assertTrue(session.canShowRecall(row))
        session.disposeForConsent()
    }
    @Test fun lateSuccessfulBrowsingDetailCannotRestoreDisposedRecallWitness() = runTest {
        val release = CompletableDeferred<Unit>()
        val started = CompletableDeferred<Unit>()
        val session = ChatSession("fixture", "team", browsingOnly = true, aiAllowed = { true }, readDetail = { _, _, _ ->
            started.complete(Unit)
            release.await()
            detail()
        })
        val fetch = launch { session.reloadFromServer() }
        started.await()
        session.disposeBrowsing()
        release.complete(Unit)
        fetch.join()
        val row = ChatRow.rows(detail().messages).filterIsInstance<ChatRow.MemoryRecall>().single()
        assertFalse(session.canShowRecall(row))
        assertTrue(session.messages.isEmpty())
        session.disposeForConsent()
    }
}
