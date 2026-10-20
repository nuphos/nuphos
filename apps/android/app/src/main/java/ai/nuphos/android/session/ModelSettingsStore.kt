package ai.nuphos.android.session

import ai.nuphos.android.data.SessionConfigState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException

/** One account/team/destination/runtime capability. Invalidation rejects every late result. */
class ModelSettingsStore(
    private val isCurrent: () -> Boolean,
    private val writable: () -> Boolean,
    private val streaming: () -> Boolean,
    private val read: suspend (Map<String, String>) -> SessionConfigState,
    private val write: (suspend (String, String) -> SessionConfigState)? = null,
) {
    var config by mutableStateOf<SessionConfigState?>(null); private set
    var error by mutableStateOf<String?>(null); private set
    var loading by mutableStateOf(false); private set
    var saving by mutableStateOf(false); private set
    var pending by mutableStateOf<Map<String, String>>(emptyMap()); private set
    private var picks: Map<String, String> = emptyMap()
    private var revision = 0L
    private var valid = true
    private fun current(ticket: Long) = valid && isCurrent() && revision == ticket
    val canEdit get() = valid && isCurrent() && writable() && config?.editable == true && !loading && !saving && error == null
    // A provider without model controls can still start a chat using its own defaults.
    // An unconfirmed explicit choice must be retried or cancelled first.
    val canStart get() = valid && isCurrent() && !loading && !saving && pending.isEmpty() && (error == null || picks.isEmpty())
    val isPreview get() = write == null
    val initialPick: Map<String, String> get() = if (valid && isCurrent() && error == null && !loading && !saving) picks else emptyMap()
    fun invalidate() { valid = false; revision++; config = null; pending = emptyMap(); picks = emptyMap(); error = null; loading = false; saving = false }
    internal fun restorePending(values: Map<String, String>) {
        check(config == null && !loading && !saving)
        pending = values.toMap()
    }
    fun cancelPending() { pending = emptyMap(); if (write == null) error = null }
    suspend fun refresh() {
        if (!valid || !isCurrent() || loading || saving) return
        val ticket = ++revision
        loading = true
        try {
            val incoming = read(if (write == null) candidatePick() else picks)
            if (!current(ticket)) return
            config = if (write == null) incoming else incoming.retaining(config)
            if (write == null) { picks = legalPicks(incoming); pending = emptyMap() }
            error = if (write == null && incoming.options.isEmpty()) "No models available. Try again." else null
        } catch (e: CancellationException) { if (current(ticket)) error = "Request cancelled. Refresh model settings before trying again."; throw e }
        catch (_: Exception) { if (current(ticket)) error = "Could not load model settings. Try again." }
        finally { if (current(ticket)) loading = false }
        if (current(ticket) && error == null) drain()
    }
    suspend fun select(id: String, value: String) {
        if (!canEdit || config?.allows(id, value) != true) return
        pending = pending + (id to value)
        if (write == null) {
            val ticket = ++revision
            saving = true
            // Model controls depend on the chosen model; do not carry old effort/fast.
            val candidate = candidatePick()
            try {
                val incoming = read(candidate)
                if (!current(ticket)) return
                config = incoming
                picks = legalPicks(incoming)
                pending = emptyMap()
                error = if (incoming.options.isEmpty()) "No models available. Try again." else null
            } catch (e: CancellationException) { if (current(ticket)) pending = emptyMap(); throw e }
            catch (_: Exception) { if (current(ticket)) error = "Could not change model settings. Try again." }
            finally { if (current(ticket)) saving = false }
        } else drain()
    }
    /** Model goes first. Every response replaces capabilities before the next write. */
    private suspend fun drain() {
        while (valid && isCurrent() && writable() && !streaming() && !loading && !saving && error == null && config?.status in setOf("ready", "dormant") && pending.isNotEmpty()) {
            val state = config ?: return
            val model = state.options.firstOrNull { it.kind == "model" }?.id
            val id = if (model != null && model in pending) model else pending.keys.sorted().first()
            val value = pending.getValue(id)
            if (!state.allows(id, value) || state.options.firstOrNull { it.id == id }?.currentValue == value) {
                pending = pending - id
                continue
            }
            val ticket = ++revision
            saving = true
            try {
                val incoming = write?.invoke(id, value) ?: return
                if (!current(ticket)) return
                config = incoming.retaining(config)
                pending = pending - id
            } catch (e: CancellationException) { if (current(ticket)) error = "Request cancelled. Refresh model settings before trying again."; throw e }
            catch (_: Exception) { if (current(ticket)) error = "Could not apply model settings. Try again or cancel pending changes." }
            finally { if (current(ticket)) saving = false }
        }
    }
    private fun candidatePick(): Map<String, String> {
        val model = config?.options?.firstOrNull { it.kind == "model" }?.id
        return (if (model != null && model in pending) emptyMap() else picks) + pending
    }
    private fun legalPicks(state: SessionConfigState) = state.options.filter {
        it.id in setOf("model", "effort", "fast") && it.options.any { choice -> choice.value == it.currentValue }
    }.associate { it.id to it.currentValue }
}
