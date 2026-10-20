package ai.nuphos.android.session

import ai.nuphos.android.data.SessionConfigState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class ModelSettingsStoreTest {
    private fun state(status: String = "ready", model: String = "a", effort: Boolean = true) = SessionConfigState(status, buildList {
        add(SessionConfigState.Option("model", "Model", "model", model, listOf(SessionConfigState.Choice("a", "Alpha"), SessionConfigState.Choice("b", "Beta"))))
        if (effort) add(SessionConfigState.Option("reasoning_effort", "Effort", "effort", "low", listOf(SessionConfigState.Choice("low", "Low"), SessionConfigState.Choice("high", "High"))))
    })
    @Test fun busyDefersLatestPickAndAppliesModelBeforeRevalidatingEffort() = runTest {
        var busy = true
        val writes = mutableListOf<Pair<String, String>>()
        val store = ModelSettingsStore({ true }, { true }, { busy }, { state(if (busy) "busy" else "ready") }, { id, value ->
            writes += id to value
            state(model = "b", effort = false)
        })
        store.refresh()
        store.select("reasoning_effort", "high"); store.select("model", "a"); store.select("model", "b")
        assertTrue(writes.isEmpty()); assertEquals("b", store.pending["model"])
        busy = false; store.refresh()
        assertEquals(listOf("model" to "b"), writes); assertTrue(store.pending.isEmpty())
    }
    @Test fun streamingDefersEvenWhenBackendReadyAndCancelSendsNothing() = runTest {
        var writes = 0
        val store = ModelSettingsStore({ true }, { true }, { true }, { state() }, { _, _ -> writes++; state() })
        store.refresh(); store.select("model", "b"); store.cancelPending(); store.refresh()
        assertEquals(0, writes); assertTrue(store.pending.isEmpty())
    }
    @Test fun writeFailureKeepsChoiceUntilExplicitRetryOrCancel() = runTest {
        var failing = true; var writes = 0
        val store = ModelSettingsStore({ true }, { true }, { false }, { state() }, { _, _ ->
            writes++; if (failing) error("synthetic failure") else state(model = "b")
        })
        store.refresh(); store.select("model", "b")
        assertNotNull(store.error); assertEquals("b", store.pending["model"])
        store.select("model", "a"); assertEquals(1, writes)
        failing = false; store.refresh()
        assertEquals(2, writes); assertNull(store.error); assertTrue(store.pending.isEmpty())
    }
    @Test fun accountTeamSessionRuntimeInvalidationRejectsLateReadsAndWrites() = runTest {
        for (write in listOf(false, true)) {
            val result = CompletableDeferred<SessionConfigState>()
            var current = true
            val store = ModelSettingsStore({ current }, { true }, { false }, { if (write) state() else result.await() },
                if (write) ({ _, _ -> result.await() }) else null)
            val job = launch { store.refresh(); if (write) store.select("model", "b") }
            testScheduler.runCurrent()
            current = false; store.invalidate(); result.complete(state(model = "b")); job.join()
            assertNull(store.config); assertTrue(store.pending.isEmpty()); assertFalse(store.saving); assertFalse(store.loading)
        }
    }
    @Test fun newModelChangeDropsOldControlsAndOnlySendsAdvertisedCombinations() = runTest {
        val requests = mutableListOf<Map<String, String>>()
        val store = ModelSettingsStore({ true }, { true }, { false }, { pick ->
            requests += pick
            state("dormant", pick["model"] ?: "a", effort = pick["model"] != "b")
        })
        store.refresh(); store.select("model", "b")
        assertEquals(mapOf("model" to "b"), requests.last())
        assertEquals(mapOf("model" to "b"), store.initialPick)
        store.select("reasoning_effort", "high"); assertEquals(2, requests.size)
    }
    @Test fun offlineRetainsDisplayButUnsupportedClearsControlsAndReadOnlyNeverWrites() = runTest {
        var state = state(); var writes = 0
        val store = ModelSettingsStore({ true }, { false }, { false }, { state }, { _, _ -> writes++; state })
        store.refresh(); store.select("model", "b"); assertEquals(0, writes)
        state = SessionConfigState("offline", emptyList()); store.refresh()
        assertEquals("Alpha", store.config?.modelTitle); assertFalse(store.canEdit)
        state = SessionConfigState("unsupported", emptyList()); store.refresh(); assertTrue(store.config!!.options.isEmpty())
    }
    @Test fun cancellationSettlesBusyAndRequiresRefreshBeforeAnotherWrite() = runTest {
        val result = CompletableDeferred<SessionConfigState>()
        val store = ModelSettingsStore({ true }, { true }, { false }, { state() }, { _, _ -> result.await() })
        store.refresh()
        val job = launch { store.select("model", "b") }
        testScheduler.runCurrent(); assertTrue(store.saving)
        job.cancel(); job.join()
        assertFalse(store.saving); assertNotNull(store.error); assertEquals("b", store.pending["model"])
        store.cancelPending(); assertTrue(store.pending.isEmpty())
    }
    @Test fun failedNewPreviewRetryKeepsRequestedModelAndCancelKeepsConfirmedPick() = runTest {
        var fail = false
        val queries = mutableListOf<Map<String, String>>()
        val store = ModelSettingsStore({ true }, { true }, { false }, { pick ->
            queries += pick
            if (fail) error("synthetic")
            state("dormant", pick["model"] ?: "a", false)
        })
        store.refresh(); fail = true; store.select("model", "b")
        assertNotNull(store.error); assertTrue(store.initialPick.isEmpty())
        fail = false; store.refresh()
        assertEquals(mapOf("model" to "b"), queries.last()); assertEquals("b", store.initialPick["model"])
        fail = true; store.select("model", "a"); store.cancelPending()
        assertNull(store.error); assertEquals("b", store.initialPick["model"])
    }

    @Test fun providerWithoutControlsCanStartButUnconfirmedExplicitPickCannot() = runTest {
        var noControls = true
        var failing = false
        val store = ModelSettingsStore({ true }, { true }, { false }, {
            if (failing) error("synthetic")
            if (noControls) SessionConfigState("unsupported", emptyList()) else state("dormant", effort = false)
        })
        store.refresh(); assertTrue(store.canStart); assertTrue(store.initialPick.isEmpty())
        noControls = false; store.refresh(); failing = true; store.select("model", "b")
        assertFalse(store.canStart); store.cancelPending(); assertTrue(store.canStart)
    }

    @Test fun restoredPendingReadsServerFirstAndSkipsAnAlreadyConfirmedWrite() = runTest {
        var writes = 0
        val store = ModelSettingsStore({ true }, { true }, { false }, { state(model = "b") }, { _, _ -> writes++; state() })
        store.restorePending(mapOf("model" to "b"))
        store.refresh()
        assertEquals(0, writes); assertTrue(store.pending.isEmpty()); assertEquals("Beta", store.config?.modelTitle)
    }

}
