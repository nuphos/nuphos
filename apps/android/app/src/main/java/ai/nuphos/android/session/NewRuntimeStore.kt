package ai.nuphos.android.session

import ai.nuphos.android.R
import ai.nuphos.android.data.*
import ai.nuphos.android.model.RuntimeIdentity
import ai.nuphos.android.model.Words
import androidx.compose.runtime.*
import kotlinx.coroutines.*
import java.util.UUID

object NewRuntime {
    val providers = listOf("claude-code", "codex", "grok", "antigravity", "opencode", "dsh", "hermes", "pi", "cursor")
    val previews = setOf("dsh", "pi", "cursor")
    sealed interface Action {
        data object Create : Action
        data class SignIn(val runtime: AgentRuntime) : Action
    }
    fun nameTaken(existing: List<AgentRuntime>, name: String) = existing.any {
        (it.local?.agentLabel ?: RuntimeIdentity.name(it.provider)).equals(name.trim(), ignoreCase = true)
    }
    fun defaultName(existing: List<AgentRuntime>, provider: String): String {
        val base = RuntimeIdentity.name(provider)
        var name = base; var n = 1
        while (nameTaken(existing, name)) { n++; name = "$base $n" }
        return name
    }
    /** Null when there is nothing to offer: Antigravity's sign-in is the computer's own, so the list leaves it out. */
    fun action(existing: List<AgentRuntime>, provider: String): Action? =
        existing.firstOrNull { it.provider == provider && it.signedIn != true }?.let { Action.SignIn(it) }
            ?: if (provider == "antigravity") null else Action.Create

}

/** Only this sheet's receipt can be removed; an existing runtime is never a receipt. */
class NewRuntimeStore(
    private val api: RuntimeCreationTransport,
    private val scope: CoroutineScope,
    val device: RuntimeDevice,
    private val existing: () -> List<AgentRuntime>,
    private val current: () -> Boolean,
    private val expired: () -> Unit,
    private val finished: () -> Unit,
) {
    var provider by mutableStateOf<String?>(null); private set
    var name by mutableStateOf("")
    var runtime by mutableStateOf<AgentRuntime?>(null); private set
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    private var receipt: CreatedRuntime? = null
    private var instanceId: String? = null
    private var requestLabel: String? = null
    private var uncertain = false
    private var closed = false
    val canEditName get() = !busy && instanceId == null
    private var connected = false
    fun action(candidate: String) = NewRuntime.action(existing(), candidate)
    val nameTaken get() = NewRuntime.nameTaken(existing(), name)
    val canCreate get() = !closed && current() && device.canAddRuntime && !busy && name.trim().length in 1..100 && !nameTaken
    fun choose(candidate: String) {
        if (closed || !current() || !device.canAddRuntime || candidate !in NewRuntime.providers || busy) return
        when (val action = NewRuntime.action(existing(), candidate)) {
            NewRuntime.Action.Create -> { provider = candidate; name = NewRuntime.defaultName(existing(), candidate) }
            is NewRuntime.Action.SignIn -> { provider = candidate; runtime = action.runtime }
            null -> Unit
        }
    }
    fun create() {
        val candidate = provider ?: return
        if (!canCreate) return
        val id = instanceId ?: UUID.randomUUID().toString().also { instanceId = it }
        val label = requestLabel ?: name.trim().also { requestLabel = it }
        busy = true; error = null
        scope.launch(NonCancellable) {
            // A request may already have reached the host when the sheet's scope goes away.
            withContext(NonCancellable) {
                try {
                    if (closed || !current()) return@withContext
                    val made = api.create(device.id, candidate, id, label)
                    receipt = made
                    if (closed || !current()) { discard(); return@withContext }
                    runtime = AgentRuntime(made.runtimeId, candidate, made.label, "active", "local", signedIn = false,
                        local = RuntimeHost(device.id, device.label, true, made.label))
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    val definite = e is RuntimeHttpFailure && e.status in 400..499 || e is NuphosApi.Failure.Unauthorized
                    if (!definite) uncertain = true
                    if (definite && !uncertain) { instanceId = null; requestLabel = null }
                    if (closed && uncertain) try { discard() } catch (_: Exception) { /* Keep the exact pending id for server reconciliation. */ }
                    fail(e)
                }
                finally { busy = false }
            }
        }
    }
    fun complete() {
        if (closed || busy || !current()) return
        connected = true; receipt = null; closed = true; finished()
    }
    fun cancel() {
        if (closed || busy) return
        if (receipt == null && !uncertain) { closed = true; finished(); return }
        busy = true; error = null
        scope.launch(NonCancellable) {
            withContext(NonCancellable) {
                try { discard(); closed = true; finished() }
                catch (e: Exception) {
                    if (e is CancellationException) throw e
                    fail(e) }
                finally { busy = false }
            }
        }
    }
    fun close() {
        if (closed) return
        closed = true
        if (!busy && (receipt != null || uncertain) && !connected) scope.launch(NonCancellable) {
            withContext(NonCancellable) { try { discard() } catch (_: Exception) { /* The server also tracks pending instances. */ } }
        }
    }
    private suspend fun discard() {
        val id = receipt?.instanceId ?: instanceId?.takeIf { uncertain } ?: return
        api.discard(device.id, id)
        receipt = null; uncertain = false
    }
    private fun fail(e: Exception) {
        if (e is NuphosApi.Failure.Unauthorized) expired()
        else if (!closed && current()) error = (e as? RuntimeHttpFailure)?.serverMessage ?: Words(R.string.new_runtime_request_failed)
    }
}
