package ai.nuphos.android.session

import ai.nuphos.android.model.AgentConversationDetail
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ConversationWatchingTest {
    // Keep permission lookups synchronous: real IO can resume after resetMain between tests.
    @Before fun setup() { Dispatchers.setMain(UnconfinedTestDispatcher()) }
    @After fun cleanup() { Dispatchers.resetMain() }
    @Test fun sharedReadOnlyReaderCanWatchButOldServerCannot() = runTest {
        for (watching in listOf(null, false, true)) {
            val session = ChatSession("fixture", "A", readBypass = { _, _ -> false }, aiAllowed = { true }, readDetail = { _, _, _ ->
                AgentConversationDetail(watching = watching, isOwner = false, readOnly = true)
            })
            session.load()
            assertFalse(session.canManage)
            assertEquals(watching != null, session.canWatch)
            assertEquals(watching, session.watching)
            session.disposeForConsent()
            assertFalse(session.canWatch)
        }
    }
    @Test fun aLateLoadCannotOverwriteAnAppliedChange() = runTest {
        val response = CompletableDeferred<AgentConversationDetail>()
        val session = ChatSession("fixture", "A", readBypass = { _, _ -> false }, aiAllowed = { true }, readDetail = { _, _, _ -> response.await() })
        val load = launch { session.load() }
        runCurrent()
        session.applyWatching(false)
        response.complete(AgentConversationDetail(watching = true))
        load.join()
        assertEquals(false, session.watching)
        session.disposeForConsent()
    }
    @Test fun aChangeElsewhereKeepsTheValueAndOnlyANewerReadReplacesIt() = runTest {
        var next: AgentConversationDetail = AgentConversationDetail(watching = true)
        val held = CompletableDeferred<AgentConversationDetail>()
        var hold = false
        val session = ChatSession("fixture", "A", readBypass = { _, _ -> false }, aiAllowed = { true },
            readDetail = { _, _, _ -> if (hold) held.await() else next })
        session.load()
        assertEquals(true, session.watching)
        hold = true
        val late = launch { session.refreshWatching() }
        runCurrent()
        session.watchingChangedElsewhere()
        assertEquals("The value stays while the read is out", true, session.watching)
        held.complete(AgentConversationDetail(watching = true))
        late.join()
        hold = false
        next = AgentConversationDetail(watching = false)
        session.refreshWatching()
        assertEquals(false, session.watching)
        session.disposeForConsent()
    }
    @Test fun aFailedReadKeepsWhatIsShown() = runTest {
        var fail = false
        val session = ChatSession("fixture", "A", readBypass = { _, _ -> false }, aiAllowed = { true },
            readDetail = { _, _, _ -> if (fail) error("synthetic") else AgentConversationDetail(watching = true) })
        session.load()
        session.applyWatching(false)
        fail = true
        runCatching { session.refreshWatching() }
        assertEquals(false, session.watching)
        assertTrue(session.canWatch)
        session.disposeForConsent()
    }
    @Test fun lateRefreshCannotRestoreStateAfterConsentOrSignOut() = runTest {
        val response = CompletableDeferred<AgentConversationDetail>()
        var allowed = true
        val session = ChatSession("fixture", "A", readBypass = { _, _ -> false }, aiAllowed = { allowed }, readDetail = { _, _, _ -> response.await() })
        val refresh = launch { session.refreshWatching() }
        runCurrent()
        allowed = false
        response.complete(AgentConversationDetail(watching = true))
        refresh.join()
        assertNull(session.watching)
        assertFalse(session.canWatch)
        session.disposeForConsent()
    }
}
