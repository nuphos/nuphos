package ai.nuphos.android.session

import ai.nuphos.android.data.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.test.*
import kotlinx.coroutines.withContext
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class RuntimesStoreTest {
    private val cloud = AgentRuntime("cloud", "codex", "Cloud", "active", "managed")
    @Test fun independentFailuresKeepCatalogButNeverStaleObservations() = runTest {
        var fail = false
        val quota = RuntimeQuota("cloud", true)
        val device = RuntimeDevice("host", "Host", true, true, "live", 40.0, null, null)
        val store = RuntimesStore(this, { true }, { listOf(cloud) },
            { if (fail) throw IOException() else mapOf("cloud" to quota) },
            { if (fail) throw IOException() else listOf(device) }, {})
        store.refresh(); advanceUntilIdle(); assertEquals(1, store.devices.size); assertTrue(store.loaded)
        fail = true; store.refresh(); advanceUntilIdle()
        assertEquals(listOf(cloud), store.runtimes); assertTrue(store.quotas.isEmpty()); assertTrue(store.devices.isEmpty())
        assertEquals(2, store.errors.size); assertFalse(store.loading)
    }
    @Test fun lateNonCancellableAccountOrWorkspaceResponseCannotPublishOrContinue() = runTest {
        val gate = CompletableDeferred<Unit>(); var current = true; var observations = 0
        val store = RuntimesStore(this, { current }, { withContext(NonCancellable) { gate.await() }; listOf(cloud) },
            { observations++; emptyMap() }, { observations++; emptyList() }, {})
        store.refresh(); runCurrent(); current = false; gate.complete(Unit); advanceUntilIdle()
        assertTrue(store.runtimes.isEmpty()); assertEquals(0, observations)
        store.close(); assertFalse(store.loading)
    }
    @Test fun closeAndUnauthorizedNeverPublishAndDoNotRepeatReads() = runTest {
        val gate = CompletableDeferred<Unit>(); var reads = 0
        val store = RuntimesStore(this, { true }, { reads++; withContext(NonCancellable) { gate.await() }; listOf(cloud) },
            { emptyMap() }, { emptyList() }, {})
        store.refresh(); store.refresh(); runCurrent(); store.close(); gate.complete(Unit); advanceUntilIdle()
        assertEquals(1, reads); assertTrue(store.runtimes.isEmpty()); store.refresh(); assertEquals(1, reads)
        var current = true; var expirations = 0
        val expired = RuntimesStore(this, { current }, { throw NuphosApi.Failure.Unauthorized },
            { error("must not read quota after expiry") }, { error("must not read devices after expiry") }, { expirations++; current = false })
        expired.refresh(); advanceUntilIdle(); assertEquals(1, expirations); assertTrue(expired.runtimes.isEmpty())
    }
    @Test fun groupingUsesExactDeviceIdentityAndNeverMergesUnidentifiedComputers() {
        val local = cloud.copy(id = "local", kind = "local", local = RuntimeHost("host", "Laptop", true))
        val other = local.copy(id = "other", local = null)
        val another = other.copy(id = "another")
        val device = RuntimeDevice("host", "Synthetic Box", true, true, "live", null, null, null)
        val groups = runtimeGroups(listOf(local, cloud, other, another), listOf(device))
        assertEquals("cloud", groups.first().key); assertEquals(4, groups.size)
        assertEquals("Synthetic Box", groups.first { it.key == "device:host" }.title)
    }
}
