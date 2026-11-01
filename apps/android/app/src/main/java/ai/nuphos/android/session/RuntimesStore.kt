package ai.nuphos.android.session

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** Each instance belongs to an exact account/workspace/consent epoch. */
class RuntimesStore(
    private val scope: CoroutineScope,
    private val sourceCurrent: () -> Boolean,
    private val readCatalog: suspend () -> List<AgentRuntime>,
    private val readQuotas: suspend () -> Map<String, RuntimeQuota>,
    private val readDevices: suspend () -> List<RuntimeDevice>,
    private val expired: () -> Unit,
) {
    var runtimes by mutableStateOf<List<AgentRuntime>>(emptyList()); private set
    var quotas by mutableStateOf<Map<String, RuntimeQuota>>(emptyMap()); private set
    var devices by mutableStateOf<List<RuntimeDevice>>(emptyList()); private set
    var loading by mutableStateOf(false); private set
    var loaded by mutableStateOf(false); private set
    var errors by mutableStateOf<List<String>>(emptyList()); private set
    private var active = true
    private var generation = 0
    private var job: Job? = null
    private fun current(ticket: Int) = active && generation == ticket && sourceCurrent()
    fun close() { active = false; generation++; job?.cancel(); runtimes = emptyList(); quotas = emptyMap(); devices = emptyList(); loading = false }
    fun refresh() {
        if (!active || !sourceCurrent() || loading) return
        loading = true
        val ticket = ++generation
        job = scope.launch {
            val failures = mutableListOf<String>()
            suspend fun <T> read(message: String, action: suspend () -> T): T? = try { action() } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (current(ticket)) {
                    if (e is NuphosApi.Failure.Unauthorized) expired() else failures += message
                }
                null
            }
            try {
                var catalogDenied = false
                val catalog = read("Could not refresh runtimes.") {
                    try { readCatalog() } catch (failure: RuntimeHttpFailure) { catalogDenied = failure.status == 403; throw failure }
                }
                if (!current(ticket)) return@launch
                if (catalogDenied) {
                    runtimes = emptyList(); quotas = emptyMap(); devices = emptyList(); loaded = false
                    errors = listOf("Runtime access is no longer available in this workspace.")
                    return@launch
                }
                val usage = read("Usage unavailable. Try refreshing.", readQuotas)
                if (!current(ticket)) return@launch
                val hosts = read("Computer status unavailable. Try refreshing.", readDevices)
                if (!current(ticket)) return@launch
                if (catalog != null) { runtimes = catalog; loaded = true }
                // A failed observation never keeps stale metrics or usage on screen.
                quotas = usage.orEmpty(); devices = hosts.orEmpty(); errors = failures
            } finally { if (current(ticket)) loading = false }
        }
    }
}

data class RuntimeGroup(val key: String, val title: String, val device: RuntimeDevice?, val runtimes: List<AgentRuntime>)
fun runtimeGroups(runtimes: List<AgentRuntime>, devices: List<RuntimeDevice>): List<RuntimeGroup> =
    runtimes.groupBy { it.local?.deviceId?.let { id -> "device:$id" } ?: if (it.kind == "managed") "cloud" else "runtime:${it.id}" }
        .map { (key, rows) ->
            val host = rows.first().local
            val device = host?.deviceId?.let { id -> devices.firstOrNull { it.id == id } }
            RuntimeGroup(key, if (key == "cloud") "Cloud" else device?.label ?: host?.deviceLabel ?: rows.first().label, device, rows)
        }.sortedBy { if (it.key == "cloud") 0 else 1 }

/** Unknown access never grants sign-in; the API also checks the current actor. */
enum class InventoryDestination { CloudDetails, ProviderSignIn, HostInstructions, AdministratorInstructions, Unavailable }
fun inventoryDestination(runtime: AgentRuntime, administrator: Boolean, devices: List<RuntimeDevice>): InventoryDestination {
    if (runtime.kind == "managed" && administrator) return InventoryDestination.CloudDetails
    if (runtime.deleting || runtime.status != "active") return InventoryDestination.Unavailable
    if (runtime.local != null) {
        val host = devices.firstOrNull { it.id == runtime.local.deviceId }
        return if (host?.box == true && host.access == "manage" && host.online) InventoryDestination.ProviderSignIn else InventoryDestination.HostInstructions
    }
    return if (administrator && runtime.kind in setOf("external", "development")) InventoryDestination.ProviderSignIn else InventoryDestination.AdministratorInstructions
}
