package ai.nuphos.android.session

import ai.nuphos.android.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class NewBoxStoreTest {
    private val device = RuntimeDevice("made", "Computer 2", true, RuntimeDevice.Box("running"), "unavailable", null, null, null, "owner")
    private val row = AgentRuntime("runtime", "codex", "Codex", "active", "local", signedIn = false, local = RuntimeHost("made", "Computer 2", true))
    private class Api : BoxTransport {
        var result = BoxInventory(emptyList(), true)
        val labels = mutableListOf<String>()
        var failure: Exception? = null
        override suspend fun inventory() = result
        override suspend fun createBox(label: String): String { labels += label; failure?.let { throw it }; return "made" }
        override suspend fun resumeBox(deviceId: String) = Unit
    }
    @Test fun namingPhasesAndExplicitResumeAccess() {
        assertEquals("Computer 1", NewBox.defaultName(listOf("Other", "Computer nope")))
        assertEquals("Computer 13", NewBox.defaultName(listOf("Computer 3", "Computer 12")))
        assertEquals(NewBox.Phase.Starting, NewBox.phase(0, 10, null, 0))
        assertEquals(NewBox.Phase.Error, NewBox.phase(0, 10, "error", 0))
        assertEquals(NewBox.Phase.Timeout, NewBox.phase(0, 300_001, null, 0))
        assertEquals(NewBox.Phase.Ready, NewBox.phase(0, 300_001, "running", 1))
        assertTrue(NewBox.resumable(device.copy(box = RuntimeDevice.Box("paused"))))
        assertFalse(NewBox.resumable(device.copy(box = RuntimeDevice.Box("paused"), access = null)))
        assertFalse(NewBox.resumable(device.copy(box = RuntimeDevice.Box("paused"), access = "use")))
    }
    @Test fun orderRechecksFlagsAndOnlyOnlineCreatedComputerRuntimesAreReady() = runTest {
        val api = Api(); var rows = emptyList<AgentRuntime>(); var time = 5L
        val store = NewBoxStore(api, { rows }, this, { true }, {}, { time })
        assertFalse(store.canCreate); store.refresh(); assertTrue(store.canCreate)
        api.result = BoxInventory(emptyList(), false)
        store.create(); advanceUntilIdle(); assertTrue(api.labels.isEmpty()); assertNotNull(store.error); assertFalse(store.canCreate)
        api.result = BoxInventory(listOf(device.copy(label = "Computer 8")), true)
        store.refresh(); store.create(); advanceUntilIdle()
        assertEquals(listOf("Computer 9"), api.labels)
        assertEquals(NewBox.Phase.Starting, store.phase)
        rows = listOf(row.copy(local = RuntimeHost("other", "Other", true)), row.copy(local = RuntimeHost("made", "Made", false)))
        store.refresh(); assertEquals(NewBox.Phase.Starting, store.phase)
        rows = listOf(row); store.refresh(); assertEquals(NewBox.Phase.Ready, store.phase)
        store.close(); store.create(); advanceUntilIdle(); assertEquals(1, api.labels.size)
    }
    @Test fun listsANewBoxsRuntimesInAFixedOrder() = runTest {
        val api = Api(); api.result = BoxInventory(listOf(device), true); var rows = emptyList<AgentRuntime>()
        val store = NewBoxStore(api, { rows }, this, { true }, {})
        store.refresh(); store.create(); advanceUntilIdle()
        fun runtime(provider: String, id: String) = row.copy(id = id, provider = provider)
        val first = listOf(runtime("grok", "g"), runtime("pi", "p"))
        val later = first + listOf(runtime("opencode", "o"), runtime("claude-code", "c"))
        rows = first; store.refresh(); assertEquals(listOf("g", "p"), store.agents.map { it.id })
        rows = later; store.refresh()
        assertEquals("Runtimes take Desktop's LOCAL_AGENT_PROVIDERS slots, whatever order they join in", listOf("c", "g", "o", "p"), store.agents.map { it.id })
        rows = later.reversed(); store.refresh(); assertEquals(listOf("c", "g", "o", "p"), store.agents.map { it.id })
    }
    @Test fun uncertainOrderCannotBeRepeatedAnd402KeepsReason() = runTest {
        val api = Api(); api.failure = java.io.IOException("lost response")
        val store = NewBoxStore(api, { emptyList() }, this, { true }, {})
        store.refresh(); store.create(); advanceUntilIdle()
        assertTrue(store.uncertain); store.create(); advanceUntilIdle(); assertEquals(1, api.labels.size)
        api.failure = RuntimeHttpFailure(402, "box_vcpu_limit", "Your plan allows no more computers.")
        val plan = NewBoxStore(api, { emptyList() }, this, { true }, {})
        plan.refresh(); plan.create(); advanceUntilIdle()
        assertTrue(plan.planFailure); assertEquals("Your plan allows no more computers.", plan.error); assertFalse(plan.uncertain)
    }
    @Test fun invalidatedSourceNeverOrdersOrPublishes() = runTest {
        val api = Api(); var current = true
        val store = NewBoxStore(api, { emptyList() }, this, { current }, {})
        store.refresh(); store.create(); current = false; advanceUntilIdle()
        assertTrue(api.labels.isEmpty()); assertNull(store.deviceId)
    }
}
