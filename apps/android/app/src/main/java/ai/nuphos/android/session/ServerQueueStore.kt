package ai.nuphos.android.session

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.AgentChatApi
import kotlinx.coroutines.CancellationException

/** A projection of the server queue, never a second dispatch queue. */
internal class ServerQueueStore(
    private val current: () -> Boolean,
    private val writable: () -> Boolean,
    private val canSteer: () -> Boolean,
    private val read: suspend () -> List<AgentChatApi.QueuedMessage>,
    private val remove: suspend (String) -> AgentChatApi.QueueRecall,
    private val steer: suspend (AgentChatApi.QueuedMessage) -> Unit,
) {
    var items by mutableStateOf(emptyList<AgentChatApi.QueuedMessage>())
        private set
    var busy by mutableStateOf(emptySet<String>())
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var recoveredText by mutableStateOf<AgentChatApi.QueueRecall?>(null)
        private set
    fun restoreRecovered(restore: (AgentChatApi.QueueRecall) -> Boolean) {
        val text = recoveredText ?: return
        if (current() && writable() && restore(text)) recoveredText = null
    }
    private var revision = 0L
    private var reading = false

    fun invalidate() { revision++; items = emptyList(); busy = emptySet(); error = null; recoveredText = null; reading = false }

    suspend fun refresh() {
        if (!current() || reading || busy.isNotEmpty()) return
        reading = true
        val epoch = revision
        try {
            val result = read()
            if (current() && revision == epoch) { items = result.filter { it.mine }.distinctBy { it.id }; error = null }
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { if (current() && revision == epoch) error = "Could not refresh queued messages. Retry to check their current state." }
        finally { if (revision == epoch) reading = false }
    }

    suspend fun take(id: String, restore: ((AgentChatApi.QueueRecall) -> Boolean)? = null) {
        if (!current() || !writable() || busy.isNotEmpty() || items.none { it.id == id } || (restore != null && recoveredText != null)) return
        val epoch = ++revision
        reading = false
        busy = busy + id
        try {
            val text = remove(id)
            if (!current() || epoch != revision) return
            items = items.filterNot { it.id == id }
            error = null
            if (restore != null) {
                recoveredText = text
                if (writable() && restore(text)) recoveredText = null
            }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            if (current() && epoch == revision) {
                if (e is AgentChatApi.Conflict.Other && e.status == 404) {
                    items = items.filterNot { it.id == id }
                    error = "This message is no longer waiting. It may already be running."
                } else error = "Could not confirm the take-back. Refresh the queue before trying again."
            }
        } finally { if (epoch == revision) busy = busy - id }
    }

    suspend fun sendIntoTurn(id: String) {
        if (!current() || !writable() || !canSteer() || busy.isNotEmpty()) return
        val item = items.firstOrNull { it.id == id } ?: return
        val epoch = ++revision
        reading = false
        busy = busy + id
        try {
            steer(item)
            if (current() && epoch == revision) { items = items.filterNot { it.id == id }; error = null }
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) {
            if (current() && epoch == revision) error = "Could not confirm steering. Refresh the queue before trying again."
        } finally { if (epoch == revision) busy = busy - id }
    }
}
