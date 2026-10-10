package ai.nuphos.android.session

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.data.WorkspaceTransport
import ai.nuphos.android.data.WorkspaceAlreadyMember
import ai.nuphos.android.model.Team
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** Process-only uncertainty flag. It does not store form text, tokens, or an action to replay. */
class WorkspaceWriteReview {
    var required: Boolean = false
        internal set
}

data class WorkspaceSetupState(
    val busy: Boolean = false,
    val memberships: List<Team> = emptyList(),
    val discoverable: List<Team> = emptyList(),
    val discoveryLoaded: Boolean = false,
    val error: String? = null,
    val discoveryError: String? = null,
    val message: String? = null,
    val reviewRequired: Boolean = false,
    val reconciled: Boolean = false,
)

/** A write receipt is not membership proof. Read back the exact ID before selection. */
class WorkspaceSetupStore(
    private val api: WorkspaceTransport,
    private val scope: CoroutineScope,
    private val sourceCurrent: () -> Boolean,
    private val applyMemberships: (List<Team>, Team?) -> Boolean,
    private val expired: () -> Unit,
    private val review: WorkspaceWriteReview = WorkspaceWriteReview(),
) {
    var state by mutableStateOf(WorkspaceSetupState(reviewRequired = review.required))
        private set
    private var generation = 0L
    private var active = true
    private var writePending = false
    private var job: Job? = null
    private fun current(ticket: Long) = active && generation == ticket && sourceCurrent()

    fun isSourceCurrent() = sourceCurrent()
    fun open() { active = true; state = state.copy(reviewRequired = review.required); refresh() }
    fun close() {
        active = false; generation++
        if (writePending) state = state.copy(reviewRequired = true, reconciled = false,
            message = "The request may have saved a workspace. Refresh and review your saved workspaces before continuing.")
        job?.cancel(); job = null; writePending = false
        state = state.copy(busy = false)
    }
    fun refresh() {
        if (state.busy || !active || !sourceCurrent()) return
        val ticket = ++generation
        state = state.copy(busy = true, error = null, reconciled = false)
        job = scope.launch {
            try {
                if (!current(ticket)) return@launch
                val saved = api.memberships()
                if (!current(ticket)) return@launch
                if (!applyMemberships(saved, null)) return@launch
                state = state.copy(memberships = saved, reconciled = true)
                try {
                    val discovery = api.discoverable()
                    if (current(ticket)) state = state.copy(discoverable = discovery, discoveryLoaded = true, discoveryError = null)
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    if (current(ticket)) {
                        if (e is NuphosApi.Failure.Unauthorized) expired()
                        else state = state.copy(discoveryError = "We could not load workspaces to join. ${errorText(e)}")
                    }
                }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (current(ticket)) fail(e)
            } finally { if (current(ticket)) state = state.copy(busy = false) }
        }
    }
    fun create(name: String) {
        if (name.trim().length !in 1..80) {
            if (!state.busy) state = state.copy(error = "Use a workspace name with 1–80 characters.")
            return
        }
        write(null) { api.create(name.trim()) }
    }
    fun join(id: String) = write(id) { api.join(id) }
    private fun write(joinId: String?, action: suspend () -> Team) {
        if (state.busy || state.reviewRequired || review.required || !active || !sourceCurrent()) return
        val ticket = ++generation
        state = state.copy(busy = true, error = null, message = null, reconciled = false)
        writePending = true
        review.required = true
        job = scope.launch {
            var target: String? = null
            var uncertain = false
            try {
                if (!current(ticket)) return@launch
                try { target = action().id }
                catch (e: Exception) {
                    if (e is CancellationException) throw e
                    if (!current(ticket)) return@launch
                    when {
                        e is NuphosApi.Failure.Unauthorized -> { review.required = false; expired(); return@launch }
                        e is WorkspaceAlreadyMember && joinId != null -> target = joinId
                        e is NuphosApi.Failure.Http && e.code in 400..499 -> { review.required = false; fail(e); return@launch }
                        e is IllegalArgumentException -> { review.required = false; fail(e); return@launch }
                        else -> uncertain = true
                    }
                }
                if (!current(ticket)) return@launch
                // From here, even a failed read must not enable another POST.
                state = state.copy(reviewRequired = true,
                    message = "The request may have saved a workspace. Review your saved workspaces before continuing.")
                val saved = api.memberships()
                if (!current(ticket)) return@launch
                val verified = if (uncertain) null else saved.firstOrNull { it.id == target }
                if (!applyMemberships(saved, verified)) return@launch
                review.required = verified == null
                state = state.copy(memberships = saved, reconciled = true,
                    reviewRequired = review.required,
                    message = if (verified != null) "Workspace selected: ${verified.name}" else
                        "We could not identify the saved result. Review your saved workspaces; no request was sent again.")
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (current(ticket)) fail(e)
            } finally {
                if (current(ticket)) { writePending = false; state = state.copy(busy = false) }
            }
        }
    }
    /** Explicit review uses only the latest successful membership read, never a matching name. */
    fun reviewSaved(id: String) {
        if (!active || !sourceCurrent() || state.busy || !state.reconciled) return
        val saved = state.memberships.firstOrNull { it.id == id } ?: return
        if (applyMemberships(state.memberships, saved)) state = state.copy(message = "Workspace selected: ${saved.name}")
    }
    fun confirmReviewed() {
        if (active && sourceCurrent() && !state.busy && state.reconciled) {
            review.required = false
            state = state.copy(reviewRequired = false, message = "Review complete. A new action can create or join another workspace.")
        }
    }
    private fun fail(e: Exception) {
        if (e is NuphosApi.Failure.Unauthorized) expired()
        else state = state.copy(error = errorText(e))
    }
    private fun errorText(e: Exception) = when {
        e is NuphosApi.Failure.Http && e.code == 403 -> "You are not allowed to join this workspace."
        e is NuphosApi.Failure.Http && e.code == 404 -> "This workspace is no longer available."
        e is NuphosApi.Failure.Http && e.code == 400 -> "The workspace request was rejected. Check the name or refresh the list."
        e is NuphosApi.Failure.Http && e.code == 409 -> "The workspace request conflicts with saved state. Refresh your workspaces."
        else -> "We could not confirm the result. Refresh your saved workspaces."
    }
}
