package ai.nuphos.android.session

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

data class RuntimeSetupState(val busy: Boolean = false, val catalogLoaded: Boolean = false,
    val error: String? = null, val message: String? = null,
    val attempt: RuntimeLogin? = null, val loginReconciled: Boolean = false,
    val attemptMismatch: Boolean = false)

/** A sheet owns bounded foreground work; the application retains only IDs and uncertainty. */
class RuntimeSetupStore(
    private val api: RuntimeTransport,
    private val scope: CoroutineScope,
    private val sourceCurrent: () -> Boolean,
    private val administrator: () -> Boolean,
    val selection: RuntimeSelections.Selection,
    private val expired: () -> Unit,
    private val now: () -> Long = System::currentTimeMillis,
) {
    var state by mutableStateOf(RuntimeSetupState())
        private set
    private var active = true
    private var foreground = false
    private var generation = 0L
    private var job: Job? = null
    private var poll: Job? = null
    private fun current(ticket: Long) = active && selection.valid && generation == ticket && sourceCurrent()
    private fun loginTargetCurrent() = selection.selected?.let {
        it.kind == "managed" && it.id == selection.loginRuntimeId && it.provider == selection.loginProvider
    } == true
    fun isSourceCurrent() = selection.valid && sourceCurrent()
    val canAdminister get() = isSourceCurrent() && administrator()
    fun open() { active = true; refresh() }
    fun close() {
        active = false; generation++; job?.cancel(); poll?.cancel(); job = null; poll = null
        state = state.copy(busy = false, attempt = null, loginReconciled = false)
    }
    fun setForeground(resumed: Boolean) {
        foreground = resumed; poll?.cancel(); poll = null
        if (resumed && active && canAdminister && selection.loginReview && loginTargetCurrent()) refreshLogin()
    }
    private fun launch(admin: Boolean = false, action: suspend (Long) -> Unit) {
        if (state.busy || !active || !isSourceCurrent() || (admin && !canAdminister)) return
        poll?.cancel(); poll = null
        val ticket = ++generation
        state = state.copy(busy = true, error = null)
        job = scope.launch {
            try {
                if (!current(ticket) || (admin && !canAdminister)) return@launch
                action(ticket)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (current(ticket)) fail(e)
            } finally {
                if (current(ticket)) { state = state.copy(busy = false); schedulePoll() }
            }
        }
    }
    fun refresh() {
        if (state.busy || !active || !isSourceCurrent()) return
        state = state.copy(catalogLoaded = false)
        launch { ticket ->
            val saved = api.catalog()
            if (!current(ticket)) return@launch
            selection.saveCatalog(saved); state = state.copy(catalogLoaded = true)
            if (canAdminister && selection.loginReview && loginTargetCurrent()) readLogin(ticket)
        }
    }
    fun select(id: String) {
        if (state.busy || !active || !isSourceCurrent() || !state.catalogLoaded) return
        if (selection.select(id)) {
            generation++; poll?.cancel(); state = state.copy(attempt = null, loginReconciled = false, attemptMismatch = false,
                message = "Agent selected for new chats. Registration does not confirm provider readiness.")
            if (selection.loginReview && selection.loginRuntimeId == id && canAdminister) refreshLogin()
        }
    }
    fun create(provider: String, label: String?) {
        val trimmed = label?.trim()
        if (provider !in setOf("claude-code", "codex") || (trimmed != null && trimmed.length !in 1..120)) {
            state = state.copy(error = "Use a supported provider and a label with 1–120 characters."); return
        }
        if (selection.createReview) return
        launch(admin = true) { ticket ->
            selection.createReview = true
            var returnedId: String? = null
            try { returnedId = api.create(provider, trimmed).id }
            catch (e: Exception) {
                if (e is CancellationException) throw e
                if (!current(ticket) || !canAdminister) return@launch
                if (definite(e)) { selection.createReview = false; throw e }
            }
            if (!current(ticket) || !canAdminister) return@launch
            state = state.copy(catalogLoaded = false,
                message = "Creation may have saved an Agent. Refresh and review the saved list before another creation.")
            val saved = api.catalog()
            if (!current(ticket) || !canAdminister) return@launch
            selection.saveCatalog(saved)
            val verified = returnedId?.let { id -> saved.firstOrNull { it.id == id && it.selectable } }
            if (verified != null) { selection.select(verified.id); selection.createReview = false }
            state = state.copy(catalogLoaded = true, message = if (verified == null)
                "We could not identify the saved result. No creation was sent again. Review saved Agents."
                else "Agent registered and selected. Provider readiness is not confirmed.")
        }
    }
    fun confirmCreateReviewed() {
        if (active && canAdminister && !state.busy && state.catalogLoaded) selection.createReview = false
    }
    fun startLogin() {
        val runtime = selection.selected?.takeIf { it.kind == "managed" } ?: return
        if (selection.loginReview) return
        launch(admin = true) { ticket ->
            selection.loginReview = true; selection.loginRuntimeId = runtime.id; selection.loginProvider = runtime.provider; selection.loginAttemptId = null
            state = state.copy(attempt = null, loginReconciled = false, attemptMismatch = false)
            val result = try { api.start(runtime.id) } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (!current(ticket) || !canAdminister) return@launch
                if (definite(e)) { selection.loginReview = false; throw e }
                state = state.copy(message = "Sign-in may have started. Read its saved status before restarting.")
                readLogin(ticket); return@launch
            }
            if (!current(ticket) || !canAdminister || selection.selectedId != runtime.id) return@launch
            selection.loginAttemptId = result.attemptId
            adopt(result, ticket)
        }
    }
    fun refreshLogin() {
        if (!selection.loginReview || !loginTargetCurrent()) return
        launch(admin = true) { ticket -> readLogin(ticket) }
    }
    private suspend fun readLogin(ticket: Long) {
        if (!current(ticket) || !canAdminister || !loginTargetCurrent()) return
        val id = selection.loginRuntimeId ?: return
        state = state.copy(loginReconciled = false)
        val result = api.login(id)
        if (!current(ticket) || !canAdminister || !loginTargetCurrent()) return
        val expected = selection.loginAttemptId
        if (expected != null && expected != result.attemptId) {
            state = state.copy(attemptMismatch = true, error = "A different sign-in is saved. This attempt cannot submit or cancel it.")
            return
        }
        selection.loginAttemptId = result.attemptId
        adopt(result, ticket)
    }
    private suspend fun adopt(result: RuntimeLogin, ticket: Long) {
        if (!current(ticket) || !canAdminister) return
        val observed = if (result.pending && !result.valid(now())) result.copy(state = "failed", verificationUri = null, userCode = null, authorizationUrl = null) else result
        state = state.copy(attempt = observed, loginReconciled = true, attemptMismatch = false,
            message = if (observed.state == "connected") "Provider sign-in connected. Refreshing saved Agent registration; readiness is not confirmed." else null)
        if (observed.state == "connected") {
            state = state.copy(catalogLoaded = false)
            val saved = api.catalog()
            if (!current(ticket) || !canAdminister) return
            selection.saveCatalog(saved); state = state.copy(catalogLoaded = true)
        }
    }
    private fun currentAttempt(): RuntimeLogin? {
        if (!active || !canAdminister || state.busy || state.attemptMismatch || !state.loginReconciled ||
            !loginTargetCurrent()) return null
        return state.attempt?.takeIf { it.attemptId == selection.loginAttemptId && it.pending && it.valid(now()) }
    }
    fun authorizationUrlFor(attemptId: String): String? = currentAttempt()
        ?.takeIf { it.attemptId == attemptId && it.state == "awaiting_authorization" }
        ?.browserUrl
    fun submitCode(code: String) {
        val attempt = currentAttempt() ?: return
        if (attempt.state != "awaiting_authorization" || attempt.authorizationUrl == null || attempt.codeSubmitted || !validRuntimeCode(code.trim())) {
            state = state.copy(error = "Paste the full code#state for this sign-in."); return
        }
        val id = selection.loginRuntimeId ?: return
        launch(admin = true) { ticket ->
            state = state.copy(loginReconciled = false)
            val result = api.code(id, attempt.attemptId, code.trim())
            if (!current(ticket) || !canAdminister) return@launch
            if (result.attemptId != attempt.attemptId) { state = state.copy(attemptMismatch = true, error = "A different sign-in response was ignored."); return@launch }
            adopt(result, ticket)
        }
    }
    fun cancelLogin() {
        val attempt = currentAttempt() ?: return
        val id = selection.loginRuntimeId ?: return
        // Remove authorization fields immediately. A DELETE receipt is still required for server cancellation.
        state = state.copy(attempt = attempt.copy(verificationUri = null, userCode = null, authorizationUrl = null), loginReconciled = false)
        launch(admin = true) { ticket ->
            api.cancel(id, attempt.attemptId)
            if (current(ticket) && canAdminister) state = state.copy(attempt = attempt.copy(state = "cancelled", verificationUri = null,
                userCode = null, authorizationUrl = null), loginReconciled = true, message = "Sign-in cancelled. The registered Agent remains saved.")
        }
    }
    fun confirmLoginRestart() {
        val attempt = state.attempt ?: return
        if (active && canAdminister && !state.busy && state.loginReconciled && !state.attemptMismatch && !attempt.pending &&
            attempt.attemptId == selection.loginAttemptId && loginTargetCurrent()) {
            selection.loginReview = false; selection.loginAttemptId = null; state = state.copy(attempt = null, loginReconciled = false)
        }
    }
    private fun schedulePoll() {
        val attempt = currentAttempt() ?: return
        if (!foreground) return
        val remaining = attempt.expiresAt - now()
        poll = scope.launch {
            delay(minOf(3_000L, remaining).coerceAtLeast(1))
            if (!active || !foreground || !canAdminister) return@launch
            if (!attempt.valid(now())) {
                state = state.copy(attempt = attempt.copy(state = "failed", verificationUri = null, userCode = null, authorizationUrl = null),
                    message = "Sign-in expired. Review its status before starting again.")
            } else refreshLogin()
        }
    }
    private fun definite(e: Exception) = e is NuphosApi.Failure.Unauthorized || e is IllegalArgumentException ||
        e is RuntimeHttpFailure && e.status in 400..499
    private fun fail(e: Exception) {
        if (e is NuphosApi.Failure.Unauthorized) expired()
        else state = state.copy(error = when {
            e is RuntimeLoginAbsent -> "No actor-bound sign-in was found. The result is unconfirmed; no new attempt was started."
            e is RuntimeHttpFailure && e.status == 403 -> "Administrator permission is required. Your account stays signed in."
            else -> "We could not confirm the Agent result. Refresh saved state before continuing."
        })
    }
}
