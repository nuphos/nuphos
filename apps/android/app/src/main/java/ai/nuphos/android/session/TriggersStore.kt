package ai.nuphos.android.session

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.*
import ai.nuphos.android.model.TriggerRow
import kotlinx.coroutines.CancellationException

class TriggersStore(private val transport: BrowsingTransport) {
    var teamId: String? by mutableStateOf(null); private set
    var rows: List<TriggerRow> by mutableStateOf(emptyList()); private set
    var phase by mutableStateOf(BrowsingPhase.Idle); private set
    var error: String? by mutableStateOf(null); private set
    var stale by mutableStateOf(false); private set
    var cronEnabled: Boolean? by mutableStateOf(null); private set
    var schedulerError: String? by mutableStateOf(null); private set
    private var generation = 0
    private var loaded = false
    suspend fun select(teamId: String?) {
        val selected = teamId?.takeIf { it.isNotBlank() }
        if (this.teamId == selected) return
        generation++; this.teamId = selected; rows = emptyList(); phase = BrowsingPhase.Idle
        error = null; stale = false; loaded = false; cronEnabled = null; schedulerError = null
        if (selected != null) refresh()
    }
    suspend fun refresh(): Boolean {
        val team = teamId ?: return false
        val request = ++generation
        phase = BrowsingPhase.Loading; error = null
        return try {
            val value = TriggerRow.decodeList(transport.get(team, "agent-triggers"))
            if (request != generation) return false
            rows = value; loaded = true; stale = false; phase = BrowsingPhase.Loaded
            cronEnabled = null; schedulerError = null
            try {
                val scheduler = transport.get(team, "agent-triggers/scheduler-status")
                val enabled = scheduler["cronEnabled"]?.boolValue ?: throw NuphosApi.Failure.InvalidResponse
                if (request == generation) cronEnabled = enabled
            } catch (e: CancellationException) { throw e } catch (_: Exception) {
                if (request == generation) schedulerError = "Could not check the cron scheduler. Existing triggers remain available."
            }
            request == generation
        } catch (e: CancellationException) { throw e } catch (e: Exception) {
            if (request == generation) {
                val denied = e is BrowsingHttpFailure && e.code in setOf(401, 403)
                if (denied) { rows = emptyList(); loaded = false; cronEnabled = null; schedulerError = null }
                stale = loaded; phase = if (denied) BrowsingPhase.Denied else BrowsingPhase.Failed
                error = if (denied) "You do not have access to triggers for this team." else "Could not load triggers. Refresh to try again."
            }
            false
        }
    }
}
