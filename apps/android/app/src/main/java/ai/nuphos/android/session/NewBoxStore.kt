package ai.nuphos.android.session

import ai.nuphos.android.R
import ai.nuphos.android.model.Words
import ai.nuphos.android.data.*
import androidx.compose.runtime.*
import kotlinx.coroutines.*

object NewBox {
    enum class Phase { Idle, Starting, Ready, Error, Timeout }
    fun defaultName(labels: List<String>): String = "Computer ${(labels.mapNotNull { Regex("Computer ([0-9]+)").matchEntire(it)?.groupValues?.get(1)?.toLongOrNull() }.maxOrNull() ?: 0).coerceAtMost(Long.MAX_VALUE - 1) + 1}"
    fun phase(madeAt: Long?, now: Long, state: String?, runtimes: Int): Phase = when {
        madeAt == null -> Phase.Idle
        runtimes > 0 -> Phase.Ready
        state == "error" -> Phase.Error
        now - madeAt > 300_000 -> Phase.Timeout
        else -> Phase.Starting
    }
    fun resumable(device: RuntimeDevice) = device.box?.state == "paused" && device.access in setOf("owner", "manage")
}

/** Scoped to the exact account, team and AI-consent generation. Closing never deletes a paid computer. */
class NewBoxStore(private val api: BoxTransport, private val catalog: suspend () -> List<AgentRuntime>,
    private val scope: CoroutineScope, private val current: () -> Boolean, private val expired: () -> Unit,
    private val clock: () -> Long = System::currentTimeMillis) {
    var inventory by mutableStateOf(BoxInventory(emptyList(), false)); private set
    var loaded by mutableStateOf(false); private set
    var name by mutableStateOf("")
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var planFailure by mutableStateOf(false); private set
    var deviceId by mutableStateOf<String?>(null); private set
    var madeAt by mutableStateOf<Long?>(null); private set
    var now by mutableStateOf(clock()); private set
    var runtimes by mutableStateOf<List<AgentRuntime>>(emptyList()); private set
    // A timed out POST may have placed an order. Do not silently place another.
    var uncertain by mutableStateOf(false); private set
    private var active = true
    private var job: Job? = null
    val placeholder get() = NewBox.defaultName(inventory.devices.map { it.label })
    val canCreate get() = active && current() && loaded && inventory.offered && !busy && !uncertain && deviceId == null && name.trim().length <= 200
    val agents get() = runtimes.filter { it.local?.deviceId == deviceId && it.local?.online == true && it.status == "active" && !it.deleting }
    val phase get() = NewBox.phase(madeAt, now, inventory.devices.firstOrNull { it.id == deviceId }?.box?.state, agents.size)
    fun close() { active = false; job?.cancel() }
    private fun valid() = active && current()
    suspend fun refresh() {
        if (!valid() || busy) return
        try {
            val devices = api.inventory()
            val rows = catalog()
            if (!valid()) return
            inventory = devices; runtimes = rows; loaded = true; now = clock()
        } catch (e: CancellationException) { throw e } catch (e: Exception) {
            if (valid()) { if (e is NuphosApi.Failure.Unauthorized) expired() else error = Words(R.string.box_refresh_failed) }
        }
    }
    fun create() {
        if (!canCreate) return
        val label = name.trim().ifEmpty { placeholder }
        busy = true; error = null; planFailure = false
        job = scope.launch {
            try {
                if (!valid()) return@launch
                // Revalidate deployment and administrator flags immediately before ordering.
                val fresh = api.inventory()
                if (!valid()) return@launch
                inventory = fresh
                if (!fresh.offered) return@launch
                val made = api.createBox(label)
                if (!valid()) return@launch
                deviceId = made; madeAt = clock(); now = clock()
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                if (valid()) {
                    if (e is NuphosApi.Failure.Unauthorized) expired()
                    else {
                        planFailure = e is RuntimeHttpFailure && e.status == 402
                        error = (e as? RuntimeHttpFailure)?.serverMessage ?: Words(R.string.box_create_failed)
                        uncertain = e !is RuntimeHttpFailure || e.status >= 500
                    }
                }
            } finally { if (valid()) busy = false }
        }
    }
}
