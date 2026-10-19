package ai.nuphos.android.session

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** A detail page never falls back to a runtime from another account, team, or catalog. */
class RuntimeDetailStore(
    private val management: RuntimeManagementTransport,
    private val api: RuntimeTransport,
    private val scope: CoroutineScope,
    private val sourceCurrent: () -> Boolean,
    private val administrator: () -> Boolean,
    val selection: RuntimeSelections.Selection,
    val runtimeId: String,
    private val expired: () -> Unit,
) {
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var message by mutableStateOf<String?>(null); private set
    var removed by mutableStateOf(false); private set
    var reconciled by mutableStateOf(runtimeId !in selection.managementReview); private set
    private var active = true
    private var generation = 0L
    private var job: Job? = null
    private fun current(ticket: Long) = active && selection.valid && sourceCurrent() && generation == ticket
    val runtime get() = if (active && selection.valid && sourceCurrent()) selection.catalog.firstOrNull { it.id == runtimeId } else null
    val canManage get() = administrator() && runtime?.let { it.kind in setOf("managed", "external") && !it.deleting } == true && !removed
    val editable get() = canManage && !busy && reconciled
    fun close() { active = false; generation++; job?.cancel(); busy = false }
    private fun launch(write: Boolean, action: suspend (Long) -> Unit) {
        if (busy || !active || !selection.valid || !sourceCurrent() || (write && !editable)) return
        val ticket = ++generation
        busy = true; error = null; message = null
        job = scope.launch {
            try {
                if (!current(ticket) || (write && !canManage)) return@launch
                action(ticket)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (current(ticket)) {
                    if (e is NuphosApi.Failure.Unauthorized) expired()
                    else error = when {
                        e is RuntimeHttpFailure && e.status == 403 -> "Administrator permission is required. Your account stays signed in."
                        else -> "Could not confirm the result. Refresh this Agent before continuing."
                    }
                }
            } finally { if (current(ticket)) busy = false }
        }
    }
    fun refresh() = launch(false) { ticket ->
        val saved = api.catalog()
        if (current(ticket)) {
            selection.saveCatalog(saved); selection.managementReview.remove(runtimeId); reconciled = true
            removed = saved.none { it.id == runtimeId }
        }
    }
    fun rename(label: String) {
        val trimmed = label.trim()
        if (trimmed.length !in 1..120 || trimmed == runtime?.label) return
        update(label = trimmed)
    }
    fun setEnabled(enabled: Boolean) = update(status = if (enabled) "active" else "disabled")
    private fun update(label: String? = null, status: String? = null) = launch(true) { ticket ->
        selection.managementReview.add(runtimeId); reconciled = false
        val result = management.update(runtimeId, label, status)
        if (!current(ticket) || !canManage) return@launch
        if (result.id != runtimeId || result.kind != runtime?.kind || result.provider != runtime?.provider) throw NuphosApi.Failure.InvalidResponse
        selection.saveCatalog(selection.catalog.map { if (it.id == runtimeId) result else it })
        selection.managementReview.remove(runtimeId); reconciled = true; message = "Agent updated."
    }
    /** Only invoked by the UI's explicit destructive confirmation. Never retried automatically. */
    fun remove() = launch(true) { ticket ->
        selection.managementReview.add(runtimeId); reconciled = false
        val deleting = management.remove(runtimeId)
        if (!current(ticket) || !canManage) return@launch
        if (deleting) selection.removalRequested.add(runtimeId)
        selection.saveCatalog(if (deleting) selection.catalog.map { if (it.id == runtimeId) it.copy(deleting = true) else it }
            else selection.catalog.filterNot { it.id == runtimeId })
        removed = !deleting; selection.managementReview.remove(runtimeId); reconciled = true
        message = if (deleting) "Removal requested. The Agent is being deleted; conversation history stays in Nuphos." else "Agent disconnected. Conversation history stays in Nuphos."
    }
}
