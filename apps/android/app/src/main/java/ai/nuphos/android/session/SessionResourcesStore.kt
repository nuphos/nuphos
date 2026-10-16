package ai.nuphos.android.session

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.model.SessionResource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext

/** Owned by one ChatSession, never shared across teams or identities. */
class SessionResourcesStore(private val read: suspend () -> List<SessionResource>) {
    var resources by mutableStateOf(emptyList<SessionResource>())
        private set
    var loading by mutableStateOf(false)
        private set
    var failed by mutableStateOf(false)
        private set
    var hasLoaded by mutableStateOf(false)
        private set
    private var generation = 0

    fun invalidate(clear: Boolean = true) {
        generation++
        loading = false
        if (clear) { resources = emptyList(); failed = false; hasLoaded = false }
    }

    suspend fun refresh(allowed: () -> Boolean = { true }) {
        if (!allowed()) { invalidate(); return }
        val ticket = ++generation
        loading = true
        failed = false
        try {
            val result = read()
            coroutineContext.ensureActive()
            if (ticket == generation && allowed()) {
                resources = result.filter { it.supported }.distinctBy { it.id }
                hasLoaded = true
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Do not retain stale titles/links after access is withdrawn, or print server errors.
            if (ticket == generation && allowed()) { resources = emptyList(); failed = true; hasLoaded = true }
        } finally {
            if (ticket == generation) {
                loading = false
                if (!allowed()) invalidate()
            }
        }
    }
}
