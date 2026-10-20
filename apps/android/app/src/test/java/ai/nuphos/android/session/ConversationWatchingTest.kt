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
    @Before fun setup() { Dispatchers.setMain(UnconfinedTestDispatcher()) }
    @After fun cleanup() { Dispatchers.resetMain() }
    @Test fun sharedReadOnlyReaderCanWatchButOldServerAndBrowsingCannot() = runTest {
        for (watching in listOf(null, false, true)) {
            val session = ChatSession("fixture", "A", aiAllowed = { true }, readDetail = { _, _, _ ->
                AgentConversationDetail(watching = watching, isOwner = false, readOnly = true)
            })
            session.load()
            assertFalse(session.canManage)
            assertEquals(watching != null, session.canWatch)
            assertEquals(watching, session.watching)
            session.disposeForConsent()
            assertFalse(session.canWatch)
        }
        val browsing = ChatSession("fixture", "A", browsingOnly = true, aiAllowed = { true },
            readDetail = { _, _, _ -> AgentConversationDetail(watching = true) })
        browsing.load()
        assertFalse(browsing.canWatch)
        browsing.disposeForConsent()
    }
    @Test fun lateLoadCannotRestoreWatchStateAfterCascadeInvalidation() = runTest {
        val response = CompletableDeferred<AgentConversationDetail>()
        val session = ChatSession("fixture", "A", aiAllowed = { true }, readDetail = { _, _, _ -> response.await() })
        val load = launch { session.load() }
        runCurrent()
        session.invalidateWatching()
        response.complete(AgentConversationDetail(watching = true))
        load.join()
        assertNull(session.watching)
        session.refreshWatching()
        assertEquals(true, session.watching)
        session.disposeForConsent()
    }
    @Test fun lateRefreshCannotRestoreStateAfterConsentOrSignOut() = runTest {
        val response = CompletableDeferred<AgentConversationDetail>()
        var allowed = true
        val session = ChatSession("fixture", "A", aiAllowed = { allowed }, readDetail = { _, _, _ -> response.await() })
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
