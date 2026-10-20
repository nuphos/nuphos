package ai.nuphos.android.session

import ai.nuphos.android.data.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class RuntimeDetailStoreTest {
    private val runtime = AgentRuntime("saved", "codex", "Saved", "active", "managed")
    private class Transport(var saved: List<AgentRuntime>) : RuntimeTransport, RuntimeManagementTransport {
        var updates = 0; var removals = 0; var reads = 0
        var failure: Exception? = null; var held: CompletableDeferred<Unit>? = null
        var deleting = true; var wrongIdentity = false
        override suspend fun catalog(): List<AgentRuntime> { reads++; failure?.let { throw it }; return saved }
        override suspend fun update(runtimeId: String, label: String?, status: String?): AgentRuntime {
            updates++
            withContext(NonCancellable) { held?.await() }
            failure?.let { throw it }
            val result = saved.first { it.id == runtimeId }.let { it.copy(label = label ?: it.label, status = status ?: it.status) }
            saved = saved.map { if (it.id == runtimeId) result else it }
            return if (wrongIdentity) result.copy(id = "other") else result
        }
        override suspend fun remove(runtimeId: String): Boolean { removals++; failure?.let { throw it }; return deleting }
        override suspend fun create(provider: String, label: String?): AgentRuntime = error("unused")
        override suspend fun start(runtimeId: String): RuntimeLogin = error("unused")
        override suspend fun login(runtimeId: String): RuntimeLogin = error("unused")
        override suspend fun code(runtimeId: String, attemptId: String, code: String): RuntimeLogin = error("unused")
        override suspend fun cancel(runtimeId: String, attemptId: String) = error("unused")
    }
    @Test fun renameDisableAndReenableKeepExactIdentityAndSelection() = runTest {
        val api = Transport(listOf(runtime)); val selected = RuntimeSelections().bind("a", "t")
        selected.saveCatalog(api.saved); selected.select(runtime.id)
        val detail = RuntimeDetailStore(api, api, this, { true }, { true }, selected, runtime.id, {})
        detail.rename(" Renamed "); advanceUntilIdle(); assertEquals("Renamed", detail.runtime?.label)
        detail.setEnabled(false); advanceUntilIdle(); assertTrue(selected.reselectionRequired); assertNull(selected.binding)
        detail.setEnabled(true); advanceUntilIdle(); assertEquals(runtime.id, selected.binding?.runtimeId)
        assertEquals(3, api.updates)
    }
    @Test fun badNamesMemberLocalDevelopmentDeletingAndRoleRevocationNeverWrite() = runTest {
        val api = Transport(listOf(runtime)); val selected = RuntimeSelections().bind("a", "t")
        var admin = false
        val detail = RuntimeDetailStore(api, api, this, { true }, { admin }, selected, runtime.id, {})
        selected.saveCatalog(api.saved); detail.remove(); detail.rename("New"); advanceUntilIdle()
        admin = true
        for (item in listOf(runtime.copy(kind = "local"), runtime.copy(kind = "development"), runtime.copy(deleting = true))) {
            selected.saveCatalog(listOf(item)); detail.remove(); detail.setEnabled(false)
        }
        selected.saveCatalog(api.saved); detail.rename(" "); detail.rename("x".repeat(121)); detail.rename("Saved")
        detail.rename("New"); admin = false; advanceUntilIdle()
        assertEquals(0, api.updates); assertEquals(0, api.removals)
    }
    @Test fun uncertainWriteSurvivesReopeningAndDoesNotRetryUntilRefresh() = runTest {
        val api = Transport(listOf(runtime)); val selected = RuntimeSelections().bind("a", "t"); selected.saveCatalog(api.saved)
        fun detail() = RuntimeDetailStore(api, api, this, { true }, { true }, selected, runtime.id, {})
        val first = detail(); api.failure = IOException(); first.remove(); advanceUntilIdle()
        assertFalse(first.reconciled); first.close()
        val next = detail(); next.remove(); advanceUntilIdle(); assertEquals(1, api.removals)
        api.failure = null; next.refresh(); advanceUntilIdle(); next.remove(); advanceUntilIdle()
        assertEquals(2, api.removals); assertTrue(next.runtime!!.deleting); assertFalse(next.editable)
        next.refresh(); advanceUntilIdle(); next.remove(); advanceUntilIdle()
        assertTrue(next.runtime!!.deleting); assertEquals(2, api.removals)
    }
    @Test fun closedOrSwitchedAccountIgnoresLateResult() = runTest {
        for (close in listOf(false, true)) {
            val api = Transport(listOf(runtime)); api.held = CompletableDeferred()
            val selections = RuntimeSelections(); val selected = selections.bind("a", "t"); selected.saveCatalog(api.saved)
            var source = true
            val detail = RuntimeDetailStore(api, api, this, { source }, { true }, selected, runtime.id, {})
            detail.rename("Late"); runCurrent()
            if (close) detail.close() else source = false
            api.held!!.complete(Unit); advanceUntilIdle()
            assertEquals("Saved", selected.catalog.single().label)
            assertTrue(runtime.id in selected.managementReview)
            assertNull(selections.bind("other", "t").selected)
        }
    }
    @Test fun externalDeletionReceiptRemovesOnlyTargetAndWrongPatchIdentityIsIgnored() = runTest {
        val external = runtime.copy(kind = "external")
        val api = Transport(listOf(external, runtime.copy(id = "other"))); api.deleting = false
        val selected = RuntimeSelections().bind("a", "t"); selected.saveCatalog(api.saved)
        val detail = RuntimeDetailStore(api, api, this, { true }, { true }, selected, runtime.id, {})
        api.wrongIdentity = true; detail.rename("Wrong"); advanceUntilIdle()
        assertEquals("Saved", detail.runtime?.label); assertFalse(detail.reconciled)
        api.wrongIdentity = false; detail.refresh(); advanceUntilIdle(); detail.remove(); advanceUntilIdle()
        assertTrue(detail.removed); assertEquals(listOf("other"), selected.catalog.map { it.id })
    }
    @Test fun roleLossAndAccountInvalidationIgnoreLateResponse() = runTest {
        for (invalidate in listOf(false, true)) {
            val api = Transport(listOf(runtime)); api.held = CompletableDeferred()
            val selections = RuntimeSelections(); val selected = selections.bind("a", "t"); selected.saveCatalog(api.saved)
            var admin = true
            val detail = RuntimeDetailStore(api, api, this, { true }, { admin }, selected, runtime.id, {})
            detail.rename("Late"); runCurrent()
            if (invalidate) selections.clear() else admin = false
            api.held!!.complete(Unit); advanceUntilIdle()
            if (invalidate) { assertTrue(selected.catalog.isEmpty()); assertFalse(selected.valid) }
            else { assertEquals("Saved", selected.catalog.single().label); assertFalse(detail.editable) }
            assertTrue(selections.bind("new-account", "t").catalog.isEmpty())
        }
    }
    @Test fun unauthorizedExpiresButForbiddenKeepsAccount() = runTest {
        for (unauthorized in listOf(false, true)) {
            val api = Transport(listOf(runtime)); val selected = RuntimeSelections().bind("a", "t"); selected.saveCatalog(api.saved)
            var expirations = 0
            val detail = RuntimeDetailStore(api, api, this, { true }, { true }, selected, runtime.id, { expirations++ })
            api.failure = if (unauthorized) NuphosApi.Failure.Unauthorized else RuntimeHttpFailure(403, null)
            detail.remove(); advanceUntilIdle()
            assertEquals(if (unauthorized) 1 else 0, expirations)
            assertEquals(runtime, detail.runtime)
        }
    }
}
