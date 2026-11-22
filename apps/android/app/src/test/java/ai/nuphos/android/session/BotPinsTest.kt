package ai.nuphos.android.session

import ai.nuphos.android.data.AgentChatApi
import ai.nuphos.android.data.SidebarFavorites
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class BotPinsTest {
    private val initial = BotPins.Scope("one", 1, 1)
    private fun saved(id: String, revision: Long = 1) = SidebarFavorites(
        listOf(SidebarFavorites.Entry(id, key = "agent-session:$id")), revision)

    @Test fun conflictReloadsAndReappliesWithoutOverwritingAnotherClientsEntries() = runTest {
        var remote = saved("original")
        var writes = 0
        val pins = BotPins({ initial }, { remote }, { team, next ->
            assertEquals("one", team)
            writes++
            if (writes == 1) {
                remote = saved("other-client", 2)
                throw AgentChatApi.Conflict.Other("sidebar_favorites_changed", "changed", 409)
            }
            assertEquals(2L, next.revision)
            remote = next.copy(revision = 3)
        })
        pins.load()
        pins.setPinned("one", "bot", "Bot", true)
        assertEquals(listOf("other-client", "bot"), pins.favorites!!.entries.map { it.sessionId })
        assertEquals(3L, pins.favorites!!.revision)
        assertEquals(2, writes); assertFalse(pins.failed); assertFalse(pins.saving)
    }

    @Test fun teamSwitchDuringReadNeverWritesAndOldResponseCannotReplaceNewTeamsFavorites() = runTest {
        var scope: BotPins.Scope? = initial
        val delayed = CompletableDeferred<SidebarFavorites>()
        var writes = 0
        val pins = BotPins({ scope }, { team -> if (team == "one") delayed.await() else saved("new-team") }, { _, _ -> writes++ })
        val old = launch { pins.setPinned("one", "bot", "Bot", true) }
        runCurrent(); assertTrue(pins.saving)
        scope = BotPins.Scope("two", 2, 1)
        assertNull(pins.favorites)
        pins.reset(); pins.load()
        delayed.complete(saved("old-team")); old.join()
        assertEquals(0, writes)
        assertEquals("new-team", pins.favorites!!.entries.single().sessionId)
        assertFalse(pins.saving); assertFalse(pins.failed)
    }

    @Test fun consentRevokedWhileReadIsInFlightPreventsPutAndReconciliation() = runTest {
        var scope: BotPins.Scope? = initial
        val delayed = CompletableDeferred<SidebarFavorites>()
        var reads = 0; var writes = 0
        val pins = BotPins({ scope }, { reads++; delayed.await() }, { _, _ -> writes++ })
        val pending = launch { pins.setPinned("one", "bot", "Bot", true) }
        runCurrent()
        scope = null
        delayed.complete(saved("old")); pending.join()
        assertEquals(1, reads); assertEquals(0, writes)
        assertNull(pins.favorites); assertFalse(pins.failed)
    }

    @Test fun leaveAndReturnToSameTeamDoesNotReviveOldPutCompletionOrQueuedMutation() = runTest {
        var scope: BotPins.Scope? = initial
        val written = CompletableDeferred<Unit>()
        var writes = 0
        val pins = BotPins({ scope }, { saved("existing") }, { _, _ -> writes++; written.await() })
        val first = launch { pins.setPinned("one", "first", "First", true) }
        runCurrent()
        val queued = launch { pins.setPinned("one", "queued", "Queued", true) }
        runCurrent()
        scope = initial.copy(workspace = 3)
        pins.reset(); pins.load()
        written.complete(Unit); first.join(); queued.join()
        assertEquals(1, writes)
        assertEquals("existing", pins.favorites!!.entries.single().sessionId)
        assertFalse(pins.saving)
    }

    @Test fun pollStartedBeforeOptimisticEditCannotRestoreUnpinnedState() = runTest {
        val poll = CompletableDeferred<SidebarFavorites>()
        var reads = 0
        val pins = BotPins({ initial }, { if (++reads == 1) poll.await() else saved("existing") }, { _, _ -> })
        val loading = launch { pins.load() }; runCurrent()
        pins.setPinned("one", "bot", "Bot", true)
        poll.complete(saved("stale")); loading.join()
        assertEquals(listOf("existing", "bot"), pins.favorites!!.entries.map { it.sessionId })
    }

    @Test fun failedWriteRestoresActualServerStateAndExposesRetryWithoutBlindMutationRetry() = runTest {
        var writes = 0
        val pins = BotPins({ initial }, { saved("existing") }, { _, _ -> writes++; error("offline") })
        pins.load(); pins.setPinned("one", "bot", "Bot", true)
        assertEquals(1, writes)
        assertEquals("existing", pins.favorites!!.entries.single().sessionId)
        assertTrue(pins.failed); assertFalse(pins.saving)
        pins.clearError(); assertFalse(pins.failed)
    }
}
