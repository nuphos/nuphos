package ai.nuphos.android.session

import ai.nuphos.android.data.AgentChatApi
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class ServerQueueStoreTest {
    private val own = AgentChatApi.QueuedMessage("mine", true, "Waiting text")
    private fun store(current: () -> Boolean = { true }, writable: () -> Boolean = { true }, canSteer: () -> Boolean = { true },
        read: suspend () -> List<AgentChatApi.QueuedMessage> = { listOf(own) },
        remove: suspend (String) -> AgentChatApi.QueueRecall = { AgentChatApi.QueueRecall(own.text) }, steer: suspend (AgentChatApi.QueuedMessage) -> Unit = {}) =
        ServerQueueStore(current, writable, canSteer, read, remove, steer)

    @Test fun onlyOwnMessagesRemainInServerOrder() = runTest {
        val second = own.copy(id = "second")
        val queue = store(read = { listOf(second, own.copy(id = "theirs", mine = false), own) })
        queue.refresh()
        assertEquals(listOf("second", "mine"), queue.items.map { it.id })
    }

    @Test fun recallUsesConfirmedTextAndDoesNotEraseExistingDraft() = runTest {
        var draft = "Unsent note"
        val queue = store(remove = { AgentChatApi.QueueRecall("Authoritative text") })
        queue.refresh(); queue.take(own.id) { draft += "\n\n${it.text}"; true }
        assertEquals("Unsent note\n\nAuthoritative text", draft)
        assertTrue(queue.items.isEmpty())
    }

    @Test fun alreadyRunningMessageIsNeverRecalled() = runTest {
        val queue = store(remove = { throw AgentChatApi.Conflict.Other("not_found", "already running", 404) })
        queue.refresh(); queue.take(own.id) { fail("Must not duplicate a running message"); true }
        assertTrue(queue.items.isEmpty()); assertNotNull(queue.error)
    }

    @Test fun failedDeleteRetainsRowAndNeverWritesDraft() = runTest {
        val queue = store(remove = { throw IllegalStateException("network") })
        queue.refresh(); queue.take(own.id) { fail("Unconfirmed payload must not be restored"); true }
        assertEquals(listOf(own), queue.items); assertNotNull(queue.error)
    }

    @Test fun duplicateTapAndRefreshCannotRaceAnOperation() = runTest {
        val held = CompletableDeferred<AgentChatApi.QueueRecall>()
        var deletes = 0
        val queue = store(remove = { deletes++; held.await() })
        queue.refresh()
        val first = async { queue.take(own.id) }
        testScheduler.runCurrent()
        queue.take(own.id); queue.refresh()
        held.complete(AgentChatApi.QueueRecall(own.text)); first.await()
        assertEquals(1, deletes); assertTrue(queue.items.isEmpty()); assertTrue(queue.busy.isEmpty())
    }

    @Test fun refreshStartedBeforeDeleteCannotResurrectTheRow() = runTest {
        var reads = 0
        val held = CompletableDeferred<List<AgentChatApi.QueuedMessage>>()
        val queue = store(read = { if (++reads == 1) listOf(own) else held.await() })
        queue.refresh()
        val oldRead = async { queue.refresh() }; testScheduler.runCurrent()
        queue.take(own.id)
        held.complete(listOf(own)); oldRead.await()
        assertTrue(queue.items.isEmpty())
    }

    @Test fun accountTeamConsentOrScreenChangeDiscardsLateResults() = runTest {
        var current = true
        val held = CompletableDeferred<AgentChatApi.QueueRecall>()
        val queue = store(current = { current }, remove = { held.await() })
        queue.refresh()
        val taking = async { queue.take(own.id) { fail("Stale owner"); true } }; testScheduler.runCurrent()
        current = false; queue.invalidate(); held.complete(AgentChatApi.QueueRecall(own.text)); taking.await()
        assertTrue(queue.items.isEmpty()); assertTrue(queue.busy.isEmpty()); assertNull(queue.error)
    }

    @Test fun readOnlyAndUnavailableSteeringNeverWrite() = runTest {
        var writes = 0
        val queue = store(writable = { false }, remove = { writes++; AgentChatApi.QueueRecall(own.text) }, steer = { writes++ })
        queue.refresh(); queue.take(own.id); queue.sendIntoTurn(own.id)
        val noSteer = store(canSteer = { false }, steer = { writes++ })
        noSteer.refresh(); noSteer.sendIntoTurn(own.id)
        assertEquals(0, writes)
    }

    @Test fun steeringFailureRetainsRowAndCanReconcileWithServer() = runTest {
        var exists = true
        val queue = store(read = { if (exists) listOf(own) else emptyList() }, steer = { throw IllegalStateException("uncertain") })
        queue.refresh(); queue.sendIntoTurn(own.id)
        assertEquals(listOf(own), queue.items); assertNotNull(queue.error)
        exists = false; queue.refresh()
        assertTrue(queue.items.isEmpty()); assertNull(queue.error)
    }

    @Test fun draftStorageFailureRetainsRecoverableText() = runTest {
        val queue = store()
        queue.refresh(); queue.take(own.id) { false }
        assertEquals(own.text, queue.recoveredText?.text)
        queue.refresh()
        assertEquals(own.text, queue.recoveredText?.text)
        queue.restoreRecovered { true }
        assertNull(queue.recoveredText)
    }
    @Test fun outstandingRecallCannotBeOverwrittenButExplicitRemovalStillWorks() = runTest {
        val file = ai.nuphos.android.model.ChatPart.File("image/png", "original.png", "data:image/png;base64,YWJj")
        val receipt = AgentChatApi.QueueRecall("First receipt", listOf(file))
        val second = own.copy(id = "second")
        val deleted = mutableListOf<String>()
        val queue = store(read = { listOf(own, second) }, remove = { id -> deleted += id; receipt })
        queue.refresh(); queue.take(own.id) { false }
        queue.take(second.id) { fail("A second recall must be blocked"); true }
        assertEquals(listOf(own.id), deleted)
        assertEquals(receipt, queue.recoveredText)
        queue.take(second.id) // Explicit Remove does not overwrite the retained recall.
        assertEquals(listOf(own.id, second.id), deleted)
        assertEquals(listOf(file), queue.recoveredText!!.files)
        queue.restoreRecovered { assertEquals(receipt, it); true }
        assertNull(queue.recoveredText)
    }

}
