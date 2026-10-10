package ai.nuphos.android.session

import ai.nuphos.android.data.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class RuntimeSetupStoreTest {
    private val runtime = AgentRuntime("saved-id", "codex", "Saved", "active", "managed")
    private val attempt = RuntimeLogin("00000000-0000-4000-8000-000000000001", "starting", 100_000)
    private class Fixture(val runtime: AgentRuntime, val attempt: RuntimeLogin) : RuntimeTransport {
        var creates = 0; var starts = 0; var reads = 0; var codes = 0; var cancels = 0
        var catalog = listOf(runtime); var login = attempt
        var error: Exception? = null; var codeError: Exception? = null; var readError: Exception? = null
        var held: CompletableDeferred<Unit>? = null
        override suspend fun catalog(): List<AgentRuntime> { reads++; readError?.let { throw it }; return catalog }
        override suspend fun create(provider: String, label: String?): AgentRuntime { creates++; held?.await(); error?.let { throw it }; return runtime }
        override suspend fun start(runtimeId: String): RuntimeLogin { starts++; held?.await(); error?.let { throw it }; return login }
        override suspend fun login(runtimeId: String): RuntimeLogin { readError?.let { throw it }; return login }
        override suspend fun code(runtimeId: String, attemptId: String, code: String): RuntimeLogin { codes++; codeError?.let { throw it }; return login }
        override suspend fun cancel(runtimeId: String, attemptId: String) { cancels++ }
    }
    private fun fixture() = Fixture(runtime, attempt)
    @Test fun createOnceRequiresExactSavedId() = runTest {
        val api = fixture(); api.held = CompletableDeferred()
        val owner = RuntimeSelections(); val store = RuntimeSetupStore(api, this, { true }, { true }, owner.bind("a", "t"), {}, { 0 })
        store.create("codex", "Saved"); store.create("codex", "Saved"); runCurrent()
        assertEquals(1, api.creates); assertNull(store.selection.selected)
        api.held!!.complete(Unit); advanceUntilIdle()
        assertEquals(runtime, store.selection.selected); assertEquals(1, api.reads)
    }
    @Test fun uncertainCreateSurvivesRecreationAndFailedRead() = runTest {
        val api = fixture(); api.error = IOException()
        val selection = RuntimeSelections().bind("a", "t")
        val first = RuntimeSetupStore(api, this, { true }, { true }, selection, {}, { 0 })
        first.create("codex", "Saved"); advanceUntilIdle()
        assertNull(selection.selected); first.close(); api.readError = IOException()
        val next = RuntimeSetupStore(api, this, { true }, { true }, selection, {}, { 0 })
        next.open(); advanceUntilIdle(); next.confirmCreateReviewed(); next.create("codex", "Saved"); advanceUntilIdle()
        assertEquals(1, api.creates); assertTrue(selection.createReview); assertFalse(next.state.catalogLoaded)
    }
    @Test fun selectionRetainsMissingIdAndNeverFallsBack() {
        val owner = RuntimeSelections(); val a = owner.bind("a", "t")
        a.saveCatalog(listOf(runtime)); assertTrue(a.select(runtime.id))
        assertEquals(runtime, owner.bind("a", "t").selected)
        a.saveCatalog(listOf(runtime.copy(id = "other")))
        assertTrue(a.reselectionRequired); assertNull(a.selected)
        assertNull(owner.bind("a", "other").selected); owner.clear(); assertNull(owner.bind("a", "t").selected)
    }
    @Test fun disabledUnknownAndDeletingCannotSelect() {
        val selected = RuntimeSelections().bind("a", "t")
        for (item in listOf(runtime.copy(status = "disabled"), runtime.copy(provider = "unknown"), runtime.copy(deleting = true), runtime.copy(kind = "unknown"))) {
            selected.saveCatalog(listOf(item)); assertFalse(selected.select(item.id))
        }
    }
    @Test fun roleChangeBeforeScheduledActionMakesNoWrite() = runTest {
        val api = fixture(); var admin = true
        val store = RuntimeSetupStore(api, this, { true }, { admin }, RuntimeSelections().bind("a", "t"), {}, { 0 })
        store.create("codex", null); admin = false; advanceUntilIdle(); assertEquals(0, api.creates)
    }
    @Test fun unknownLoginStartReadsBeforeExplicitRestartAnd404DoesNotConnect() = runTest {
        val api = fixture(); api.error = IOException(); api.readError = RuntimeLoginAbsent()
        val selection = RuntimeSelections().bind("a", "t"); selection.saveCatalog(listOf(runtime)); selection.select(runtime.id)
        val store = RuntimeSetupStore(api, this, { true }, { true }, selection, {}, { 0 })
        store.startLogin(); advanceUntilIdle(); store.startLogin(); advanceUntilIdle()
        assertEquals(1, api.starts); assertTrue(selection.loginReview); assertNull(store.state.attempt)
        assertFalse(store.state.loginReconciled)
    }
    @Test fun wrongAttemptCannotReplaceSubmitOrCancel() = runTest {
        val api = fixture(); val selection = RuntimeSelections().bind("a", "t"); selection.saveCatalog(listOf(runtime)); selection.select(runtime.id)
        val store = RuntimeSetupStore(api, this, { true }, { true }, selection, {}, { 0 })
        store.startLogin(); advanceUntilIdle()
        api.login = attempt.copy(attemptId = "00000000-0000-4000-8000-000000000002", state = "awaiting_authorization", authorizationUrl = "https://example.test/auth")
        store.refreshLogin(); advanceUntilIdle(); store.submitCode("code#state"); store.cancelLogin(); advanceUntilIdle()
        assertEquals(attempt.attemptId, store.state.attempt?.attemptId); assertEquals(0, api.codes); assertEquals(0, api.cancels)
    }
    @Test fun codeExpiryAndDismissalStopWork() = runTest {
        val api = fixture(); api.login = attempt.copy(state = "awaiting_authorization", authorizationUrl = "https://example.test/auth")
        var now = 0L; val selection = RuntimeSelections().bind("a", "t"); selection.saveCatalog(listOf(runtime)); selection.select(runtime.id)
        val store = RuntimeSetupStore(api, this, { true }, { true }, selection, {}, { now })
        store.startLogin(); advanceUntilIdle(); store.submitCode("missing-state"); advanceUntilIdle(); assertEquals(0, api.codes)
        now = attempt.expiresAt; store.submitCode("code#state"); store.cancelLogin(); advanceUntilIdle()
        assertEquals(0, api.codes); assertEquals(0, api.cancels)
        store.close(); assertNull(store.state.attempt)
    }
    @Test fun connectedRefreshesCatalogButDoesNotAssertReadiness() = runTest {
        val api = fixture(); api.login = attempt.copy(state = "connected")
        val selection = RuntimeSelections().bind("a", "t"); selection.saveCatalog(listOf(runtime)); selection.select(runtime.id)
        val store = RuntimeSetupStore(api, this, { true }, { true }, selection, {}, { 0 })
        store.startLogin(); advanceUntilIdle(); assertEquals(1, api.reads); assertEquals("connected", store.state.attempt?.state)
    }
    @Test fun selectionChangeCannotReplaceAnotherRuntimeUncertainty() = runTest {
        val api = fixture(); val other = runtime.copy(id = "other")
        val selection = RuntimeSelections().bind("a", "t"); selection.saveCatalog(listOf(runtime, other)); selection.select(runtime.id)
        val store = RuntimeSetupStore(api, this, { true }, { true }, selection, {}, { 0 })
        store.startLogin(); advanceUntilIdle(); selection.select(other.id); store.startLogin(); advanceUntilIdle()
        assertEquals(1, api.starts); assertEquals(runtime.id, selection.loginRuntimeId)
        selection.select(runtime.id); store.refreshLogin(); advanceUntilIdle()
        assertEquals(attempt.attemptId, store.state.attempt?.attemptId)
    }
    @Test fun overlappingRefreshCannotEraseAcceptedCatalogState() = runTest {
        val api = fixture(); val selection = RuntimeSelections().bind("a", "t")
        val store = RuntimeSetupStore(api, this, { true }, { true }, selection, {}, { 0 })
        store.open(); advanceUntilIdle(); assertTrue(store.state.catalogLoaded)
        api.held = CompletableDeferred(); store.create("codex", null); runCurrent()
        store.refresh(); assertTrue(store.state.catalogLoaded)
        api.held!!.complete(Unit); advanceUntilIdle()
    }

    @Test fun browserRechecksExpiryRoleAndSelectedAttemptAtClickTime() = runTest {
        val api = fixture(); api.login = attempt.copy(state = "awaiting_authorization", authorizationUrl = "https://example.test/auth")
        var clock = 0L; var admin = true
        val selection = RuntimeSelections().bind("a", "t"); selection.saveCatalog(listOf(runtime, runtime.copy(id = "other"))); selection.select(runtime.id)
        val store = RuntimeSetupStore(api, this, { true }, { admin }, selection, {}, { clock })
        store.startLogin(); advanceUntilIdle()
        assertEquals("https://example.test/auth", store.authorizationUrlFor(attempt.attemptId))
        assertNull(store.authorizationUrlFor("wrong")); admin = false; assertNull(store.authorizationUrlFor(attempt.attemptId))
        admin = true; clock = attempt.expiresAt; assertNull(store.authorizationUrlFor(attempt.attemptId))
        clock = 0; selection.select("other"); assertNull(store.authorizationUrlFor(attempt.attemptId))
        store.close(); assertNull(store.authorizationUrlFor(attempt.attemptId))
    }
    @Test fun foregroundPollingStopsAtPauseDismissalAndExpiry() = runTest {
        val api = fixture(); var clock = 0L
        val selection = RuntimeSelections().bind("a", "t"); selection.saveCatalog(listOf(runtime)); selection.select(runtime.id)
        val store = RuntimeSetupStore(api, this, { true }, { true }, selection, {}, { clock })
        store.startLogin(); advanceUntilIdle(); store.setForeground(true); runCurrent()
        store.setForeground(false); advanceTimeBy(10_000); runCurrent(); assertFalse(store.state.busy)
        clock = attempt.expiresAt; store.setForeground(true); runCurrent()
        assertEquals("failed", store.state.attempt?.state); store.close(); advanceUntilIdle(); assertNull(store.state.attempt)
    }

    @Test fun sameIdProviderChangeCannotReusePendingAuthorization() = runTest {
        val api = fixture(); api.login = attempt.copy(state = "awaiting_authorization", authorizationUrl = "https://example.test/auth")
        val selection = RuntimeSelections().bind("a", "t"); selection.saveCatalog(listOf(runtime)); selection.select(runtime.id)
        val store = RuntimeSetupStore(api, this, { true }, { true }, selection, {}, { 0 })
        store.startLogin(); advanceUntilIdle()
        selection.saveCatalog(listOf(runtime.copy(provider = "claude-code")))
        assertNull(store.authorizationUrlFor(attempt.attemptId))
        store.submitCode("code#state"); store.cancelLogin(); advanceUntilIdle()
        assertEquals(0, api.codes); assertEquals(0, api.cancels)
    }

    @Test fun uncertainCodeMustReadStatusBeforeAnyFurtherCodeWrite() = runTest {
        val api = fixture(); api.login = attempt.copy(state = "awaiting_authorization", authorizationUrl = "https://example.test/auth")
        val selection = RuntimeSelections().bind("a", "t"); selection.saveCatalog(listOf(runtime)); selection.select(runtime.id)
        val store = RuntimeSetupStore(api, this, { true }, { true }, selection, {}, { 0 })
        store.startLogin(); advanceUntilIdle(); api.codeError = IOException()
        store.submitCode("code#state"); advanceUntilIdle(); store.submitCode("code#state"); advanceUntilIdle()
        assertEquals(1, api.codes); assertFalse(store.state.loginReconciled)
        api.login = api.login.copy(codeSubmitted = true); store.refreshLogin(); advanceUntilIdle()
        store.submitCode("code#state"); advanceUntilIdle(); assertEquals(1, api.codes)
    }

}
