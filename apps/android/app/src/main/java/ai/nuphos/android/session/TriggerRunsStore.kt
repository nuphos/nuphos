package ai.nuphos.android.session

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.BrowsingHttpFailure
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.AgentConversationsPage
import ai.nuphos.android.model.validTriggerId
import kotlinx.coroutines.CancellationException

class TriggerRunsStore(private val fetch: suspend (String, String, String?) -> AgentConversationsPage) {
    var teamId: String? by mutableStateOf(null); private set
    var triggerId: String? by mutableStateOf(null); private set
    var rows: List<AgentConversation> by mutableStateOf(emptyList()); private set
    var phase by mutableStateOf(BrowsingPhase.Idle); private set
    var error: String? by mutableStateOf(null); private set
    var stale by mutableStateOf(false); private set
    var hasMore by mutableStateOf(false); private set
    private var cursor: String? = null
    private var generation = 0
    private var loaded = false
    suspend fun select(teamId: String?, triggerId: String?) {
        val team = teamId?.takeIf { it.isNotBlank() }
        val trigger = triggerId?.takeIf(::validTriggerId)
        if (this.teamId == team && this.triggerId == trigger) return
        generation++; this.teamId = team; this.triggerId = trigger
        rows = emptyList(); phase = BrowsingPhase.Idle; error = null; stale = false
        hasMore = false; cursor = null; loaded = false
        if (team != null && trigger != null) refresh()
        else if (triggerId != null) { phase = BrowsingPhase.Failed; error = "Select a valid trigger and team to view runs." }
    }
    suspend fun refresh(): Boolean = load(false)
    suspend fun loadMore(): Boolean {
        if (!hasMore || cursor == null || phase == BrowsingPhase.Loading) return false
        return load(true)
    }
    private suspend fun load(append: Boolean): Boolean {
        val team = teamId ?: return false
        val trigger = triggerId?.takeIf(::validTriggerId) ?: return false
        val previousCursor = if (append) cursor else null
        val request = ++generation
        phase = BrowsingPhase.Loading; error = null
        return try {
            val page = fetch(team, trigger, previousCursor)
            if (request != generation) false else {
                val permitted = page.conversations.filter { it.teamId == team && it.sessionId.isNotBlank() }
                rows = ((if (append) rows else emptyList()) + permitted).distinctBy { it.sessionId }
                cursor = page.nextCursor?.takeIf { it.isNotBlank() && it != previousCursor }
                hasMore = page.hasMore && cursor != null
                loaded = true; stale = false; phase = BrowsingPhase.Loaded; true
            }
        } catch (e: CancellationException) { throw e } catch (e: Exception) {
            if (request == generation) {
                val denied = e == NuphosApi.Failure.Unauthorized || (e is BrowsingHttpFailure && e.code in setOf(401, 403))
                if (denied) { rows = emptyList(); loaded = false; cursor = null; hasMore = false }
                stale = loaded; phase = if (denied) BrowsingPhase.Denied else BrowsingPhase.Failed
                error = if (denied) "You do not have access to runs for this team." else "Could not load runs. Refresh to try again."
            }
            false
        }
    }
}
