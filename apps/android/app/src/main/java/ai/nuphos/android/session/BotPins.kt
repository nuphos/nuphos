package ai.nuphos.android.session

import ai.nuphos.android.data.AgentChatApi
import ai.nuphos.android.data.SidebarFavorites
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Scope includes revisions so leaving and returning to the same team never revives an old request. */
internal class BotPins(
    private val scope: () -> Scope?,
    private val read: suspend (String) -> SidebarFavorites,
    private val write: suspend (String, SidebarFavorites) -> Unit,
) {
    data class Scope(val team: String, val workspace: Long, val consent: Long)
    private var owner: Scope? = null
    private var stored by mutableStateOf<SidebarFavorites?>(null)
    private var failure by mutableStateOf(false)
    private var busy by mutableStateOf(false)
    private var epoch = 0L
    private val writes = Mutex()

    val favorites: SidebarFavorites? get() = stored.takeIf { owner != null && owner == scope() }
    val failed: Boolean get() = failure && owner == scope()
    val saving: Boolean get() = busy && owner == scope()

    fun reset() {
        epoch++
        owner = null
        stored = null
        failure = false
        busy = false
    }

    fun clearError() { failure = false }

    suspend fun load() {
        val captured = scope() ?: return
        // Polls must not overwrite an optimistic edit or a newer listing.
        if (saving) return
        val request = ++epoch
        try {
            currentCoroutineContext().ensureActive()
            val result = read(captured.team)
            currentCoroutineContext().ensureActive()
            if (request == epoch && captured == scope()) {
                owner = captured
                stored = result
                busy = false
            }
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { /* A failed poll retains the last good list. */ }
    }

    suspend fun setPinned(team: String, session: String, label: String, pinned: Boolean) {
        val captured = scope()?.takeIf { it.team == team } ?: return
        writes.withLock {
            if (captured != scope()) return
            val request = ++epoch
            suspend fun current(): Boolean {
                currentCoroutineContext().ensureActive()
                return request == epoch && captured == scope()
            }
            val previous = favorites
            owner = captured
            stored = (previous ?: SidebarFavorites(emptyList(), 0)).settingPinned(team, session, label, pinned)
            busy = true
            failure = false
            try {
                repeat(4) { attempt ->
                    if (!current()) return
                    val latest = read(team)
                    if (!current()) return
                    val next = latest.settingPinned(team, session, label, pinned)
                    try {
                        write(team, next)
                    } catch (e: AgentChatApi.Conflict.Other) {
                        if (e.status == 409 && e.code == "sidebar_favorites_changed" && attempt < 3) return@repeat
                        throw e
                    }
                    if (current()) stored = next.copy(revision = next.revision + 1)
                    return
                }
            } catch (e: CancellationException) {
                if (request == epoch && captured == scope()) stored = previous
                throw e
            } catch (_: Exception) {
                if (current()) {
                    stored = previous
                    failure = true
                    // A write may have succeeded before transport failed. Reconcile, without retrying a mutation.
                    try {
                        val actual = read(team)
                        if (current()) stored = actual
                    } catch (e: CancellationException) { throw e }
                    catch (_: Exception) { /* Keep the last known state and expose retry. */ }
                }
            } finally {
                if (request == epoch && captured == scope()) busy = false
            }
        }
    }
}
