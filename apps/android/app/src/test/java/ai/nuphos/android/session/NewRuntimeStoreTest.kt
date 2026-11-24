package ai.nuphos.android.session

import ai.nuphos.android.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class NewRuntimeStoreTest {
    private val host = RuntimeDevice("host", "Laptop", true, null, "unavailable", null, null, null, "manage")
    private fun runtime(name: String = "Codex", signedIn: Boolean = true, provider: String = "codex") = AgentRuntime("old", provider, "Codex on Laptop", "active", "local", signedIn = signedIn,
        local = RuntimeHost("host", "Laptop", true, name))
    private class Api : RuntimeCreationTransport {
        val ids = mutableListOf<String>(); val removed = mutableListOf<String>()
        var failure: Exception? = null
        var gate: CompletableDeferred<Unit>? = null
        var discardFailure: Exception? = null
        override suspend fun create(deviceId: String, provider: String, instanceId: String, label: String): CreatedRuntime {
            ids += instanceId; gate?.await(); failure?.let { throw it }
            return CreatedRuntime(instanceId, "made", label)
        }
        override suspend fun discard(deviceId: String, instanceId: String) { discardFailure?.let { throw it }; removed += instanceId }
    }
    @Test fun providersReuseSignedOutAndRespectSharedAntigravity() {
        assertEquals(listOf("claude-code", "codex", "grok", "antigravity", "opencode", "dsh", "hermes", "pi"), NewRuntime.providers)
        assertEquals(setOf("dsh", "pi"), NewRuntime.previews)
        assertTrue(NewRuntime.action(listOf(runtime(signedIn = false)), "codex") is NewRuntime.Action.SignIn)
        // Antigravity's sign-in is the computer's own: without it, or signed in, there is nothing to list.
        assertNull(NewRuntime.action(emptyList(), "antigravity"))
        assertNull(NewRuntime.action(listOf(runtime(provider = "antigravity")), "antigravity"))
        assertTrue(NewRuntime.action(listOf(runtime(provider = "antigravity", signedIn = false)), "antigravity") is NewRuntime.Action.SignIn)
        assertEquals("Codex 3", NewRuntime.defaultName(listOf(runtime(), runtime("codex 2")), "codex"))
        assertTrue(NewRuntime.nameTaken(listOf(runtime()), " codEX "))
    }
    @Test fun onlyExplicitManagersOfRunningComputersCanAddAndEmptyHostsAreListed() {
        assertTrue(host.canAddRuntime)
        assertTrue(host.copy(access = "owner").canAddRuntime)
        assertFalse(host.copy(access = "use").canAddRuntime)
        assertFalse(host.copy(access = null).canAddRuntime)
        assertFalse(host.copy(online = false).canAddRuntime)
        assertFalse(host.copy(box = RuntimeDevice.Box("paused")).canAddRuntime)
        assertTrue(host.copy(box = RuntimeDevice.Box("running")).canAddRuntime)
        assertTrue(runtimeGroups(emptyList(), listOf(host)).isEmpty())
        assertEquals(host, runtimeGroups(emptyList(), listOf(host), includeEmptyDevices = true).single().device)
    }
    @Test fun existingSignInNeverDeletesAnInstance() = runTest {
        val api = Api(); var done = 0
        val store = NewRuntimeStore(api, this, host, { listOf(runtime(signedIn = false)) }, { true }, {}, { done++ })
        store.choose("codex"); assertEquals("old", store.runtime?.id)
        store.cancel(); advanceUntilIdle()
        assertEquals(1, done); assertTrue(api.ids.isEmpty()); assertTrue(api.removed.isEmpty())
    }
    @Test fun cancellationDeletesOnlyCreatedReceiptAndSuccessKeepsIt() = runTest {
        val api = Api(); var done = 0
        val store = NewRuntimeStore(api, this, host, { emptyList() }, { true }, {}, { done++ })
        store.choose("codex"); store.create(); advanceUntilIdle()
        assertEquals("made", store.runtime?.id)
        store.cancel(); advanceUntilIdle(); assertEquals(api.ids, api.removed); assertEquals(1, done)
        val keep = Api()
        val complete = NewRuntimeStore(keep, this, host, { emptyList() }, { true }, {}, {})
        complete.choose("codex"); complete.create(); advanceUntilIdle(); complete.complete(); complete.close(); advanceUntilIdle()
        assertTrue(keep.removed.isEmpty())
    }
    @Test fun lostResponseRetryUsesSameInstanceAndServer409IsVisible() = runTest {
        val api = Api(); api.failure = IOException()
        val store = NewRuntimeStore(api, this, host, { emptyList() }, { true }, {}, {})
        store.choose("codex"); store.create(); advanceUntilIdle()
        api.failure = RuntimeHttpFailure(409, "agent_instances_unavailable", "Update Nuphos on this computer.")
        store.create(); advanceUntilIdle()
        assertEquals(1, api.ids.distinct().size); assertEquals("Update Nuphos on this computer.", store.error)
    }
    @Test fun uncertainCreationIsCleanedOnCancelAndCleanupFailureCanBeRetried() = runTest {
        val api = Api(); api.failure = IOException(); var done = 0
        val store = NewRuntimeStore(api, this, host, { emptyList() }, { true }, {}, { done++ })
        store.choose("codex"); store.create(); advanceUntilIdle()
        assertFalse(store.canEditName)
        api.discardFailure = IOException(); store.cancel(); advanceUntilIdle()
        assertEquals(0, done); assertNotNull(store.error)
        api.discardFailure = null; store.cancel(); advanceUntilIdle()
        assertEquals(api.ids, api.removed); assertEquals(1, done)
    }
    @Test fun sourceInvalidatedBeforeDispatchNeverCreates() = runTest {
        val api = Api(); var current = true
        val store = NewRuntimeStore(api, this, host, { emptyList() }, { current }, {}, {})
        store.choose("codex"); store.create(); current = false; store.close(); advanceUntilIdle()
        assertTrue(api.ids.isEmpty()); assertTrue(api.removed.isEmpty()); assertNull(store.runtime)
    }
    @Test fun accountChangeWhileCreateIsInFlightCleansUpWithoutPublishing() = runTest {
        val api = Api(); api.gate = CompletableDeferred(); var current = true
        val store = NewRuntimeStore(api, this, host, { emptyList() }, { current }, {}, {})
        store.choose("codex"); store.create(); runCurrent(); current = false; store.close()
        api.gate!!.complete(Unit); advanceUntilIdle()
        assertNull(store.runtime); assertEquals(api.ids, api.removed)
    }
}
