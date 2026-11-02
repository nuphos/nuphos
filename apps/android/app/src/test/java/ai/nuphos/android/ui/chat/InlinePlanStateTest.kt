package ai.nuphos.android.ui.chat

import ai.nuphos.android.model.Plan
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class InlinePlanStateTest {
    private val partial = Plan("plan", title = "Synthetic plan")
    private val ready = partial.copy(
        steps = listOf(Plan.Step("Inspect", jobs = listOf(Plan.Job("Read configuration")))),
        costSummary = "No cost", riskWorstCase = "Read fails", riskMitigations = listOf("Retry safely"),
    )

    @Test fun partialPlanCannotApproveUntilAFreshPollCompletesItsDraft() = runTest {
        val state = InlinePlanState()
        var writes = 0
        state.refresh { partial }
        assertFalse(state.decide(false, false, true) { writes++; ready.copy(status = "approved") })
        assertEquals(0, writes)
        state.refresh { ready }
        assertTrue(state.decide(false, false, true) { writes++; ready.copy(status = "approved") })
        assertEquals(1, writes)
        assertEquals("approved", state.plan?.status)
        assertFalse(state.decide(false, false, true) { writes++; ready })
        assertEquals(1, writes)
    }

    @Test fun readonlyAndStreamingPreventWritesBeforeAndAfterReadiness() = runTest {
        val state = InlinePlanState()
        var writes = 0
        for (plan in listOf(partial, ready)) {
            state.refresh { plan }
            for (approve in listOf(true, false)) {
                assertFalse(state.decide(true, false, approve) { writes++; ready })
                assertFalse(state.decide(false, true, approve) { writes++; ready })
            }
        }
        assertEquals(0, writes)
    }

    @Test fun readinessIsRecheckedAfterTheDisplayedReadySnapshotChanges() = runTest {
        val state = InlinePlanState()
        var writes = 0
        state.refresh { ready }
        state.refresh { partial }
        assertFalse(state.decide(false, false, true) { writes++; ready })
        assertEquals(0, writes)
        assertTrue(state.decide(false, false, false) { writes++; partial.copy(status = "rejected") })
        assertEquals(1, writes)
    }

    @Test fun heldProposedReadCannotUndoApprovalOrRejection() = runTest {
        for (status in listOf("approved", "rejected")) {
            val state = InlinePlanState()
            state.refresh { ready }
            val release = CompletableDeferred<Unit>()
            val oldRead = launch { state.refresh { release.await(); ready } }
            runCurrent()
            assertTrue(state.decide(false, false, status == "approved") { ready.copy(status = status) })
            release.complete(Unit)
            oldRead.join()
            assertEquals(status, state.plan?.status)
            assertFalse(state.decide(false, false, true) { error("A completed decision must not reappear") })
            if (status == "approved") {
                state.refresh { ready.copy(status = "executing") }
                assertEquals("executing", state.plan?.status)
            }
        }
    }

    @Test fun readsStartedDuringAnActionCannotOverwriteItsResultAndBusyRejectsDuplicates() = runTest {
        val state = InlinePlanState()
        state.refresh { ready }
        val finishAction = CompletableDeferred<Unit>()
        val finishRead = CompletableDeferred<Unit>()
        var writes = 0
        val action = launch { state.decide(false, false, false) { writes++; finishAction.await(); ready.copy(status = "rejected") } }
        runCurrent()
        val read = launch { state.refresh { finishRead.await(); ready } }
        runCurrent()
        assertTrue(state.busy)
        assertFalse(state.decide(false, false, true) { writes++; ready })
        finishAction.complete(Unit)
        action.join()
        finishRead.complete(Unit)
        read.join()
        assertEquals(1, writes)
        assertEquals("rejected", state.plan?.status)
        assertFalse(state.busy)
    }

    @Test fun failedMutationInvalidatesOlderReadsAndFreshPollingCanRecover() = runTest {
        val state = InlinePlanState()
        state.refresh { ready }
        val release = CompletableDeferred<Unit>()
        val old = launch { state.refresh { release.await(); partial } }
        runCurrent()
        state.decide(false, false, true) { throw IllegalStateException("Denied") }
        release.complete(Unit)
        old.join()
        assertTrue(state.plan!!.isReadyForApproval)
        assertEquals("Denied", state.error)
        state.refresh { ready.copy(status = "approved") }
        assertEquals("approved", state.plan?.status)
        assertNull(state.error)
    }
}
