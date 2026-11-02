package ai.nuphos.android.ui.chat

import ai.nuphos.android.model.Plan
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException

/** Main-thread state owner shared by polling and plan decisions. */
internal class InlinePlanState {
    var plan by mutableStateOf<Plan?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    private var generation = 0L

    suspend fun refresh(load: suspend () -> Plan): Boolean {
        val ticket = generation
        try {
            val result = load()
            if (ticket == generation && !busy) {
                plan = result
                error = null
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (ticket == generation && !busy && plan == null) error = e.message ?: "Couldn't load the plan."
        }
        return busy || plan?.isActive == true
    }

    suspend fun decide(readOnly: Boolean, streaming: Boolean, approve: Boolean, action: suspend (String) -> Plan): Boolean {
        val current = plan ?: return false
        if (busy || readOnly || streaming || current.status != "proposed" || (approve && !current.isReadyForApproval)) return false
        generation++
        busy = true
        try {
            plan = action(current.id)
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message ?: "Action failed. Try again."
        } finally {
            generation++
            busy = false
        }
        return true
    }
}
