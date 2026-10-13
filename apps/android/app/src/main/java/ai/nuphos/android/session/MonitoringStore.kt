package ai.nuphos.android.session

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.*
import ai.nuphos.android.model.MonitoringOverview
import kotlinx.coroutines.CancellationException

enum class BrowsingPhase { Idle, Loading, Loaded, Failed, Denied }
class MonitoringStore(private val transport: BrowsingTransport) {
    var teamId: String? by mutableStateOf(null); private set
    var overview by mutableStateOf(MonitoringOverview()); private set
    var phase by mutableStateOf(BrowsingPhase.Idle); private set
    var error: String? by mutableStateOf(null); private set
    var stale by mutableStateOf(false); private set
    private var generation = 0
    private var loaded = false
    suspend fun select(teamId: String?) {
        val selected = teamId?.takeIf { it.isNotBlank() }
        if (this.teamId == selected) return
        generation++; this.teamId = selected; overview = MonitoringOverview()
        phase = BrowsingPhase.Idle; error = null; stale = false; loaded = false
        if (selected != null) refresh()
    }
    suspend fun refresh(): Boolean {
        val team = teamId ?: return false
        val request = ++generation
        phase = BrowsingPhase.Loading; error = null
        return try {
            val value = MonitoringOverview.decode(transport.get(team, "monitoring/overview"))
            if (request != generation) false else {
                overview = value; phase = BrowsingPhase.Loaded; loaded = true; stale = false; true
            }
        } catch (e: CancellationException) { throw e } catch (e: Exception) {
            if (request == generation) {
                val denied = e is BrowsingHttpFailure && e.code in setOf(401, 403)
                if (denied) { overview = MonitoringOverview(); loaded = false }
                stale = loaded; phase = if (denied) BrowsingPhase.Denied else BrowsingPhase.Failed
                error = if (denied) "You do not have access to monitoring for this team." else "Could not load monitoring. Refresh to try again."
            }
            false
        }
    }
}
