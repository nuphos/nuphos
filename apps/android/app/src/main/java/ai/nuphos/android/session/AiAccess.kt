package ai.nuphos.android.session

import androidx.compose.runtime.mutableStateOf

/** Account consent with a revision that invalidates retained session capabilities. */
object AiAccess {
    private data class Access(val token: String? = null, val granted: Boolean = false, val revision: Long = 0)
    private val state = mutableStateOf(Access())

    var onRevoked: () -> Unit = {}

    val revision: Long get() = synchronized(this) { state.value.revision }

    @Synchronized fun activate(token: String) {
        state.value = Access(token, false, state.value.revision + 1)
    }

    @Synchronized fun grant(token: String) {
        if (state.value.token == token) state.value = state.value.copy(granted = true)
    }

    @Synchronized fun grantIfCurrent(token: String, revision: Long): Boolean {
        if (state.value.token != token || state.value.revision != revision) return false
        state.value = state.value.copy(granted = true)
        return true
    }

    fun revoke() {
        val wasGranted = synchronized(this) {
            val granted = state.value.granted
            state.value = state.value.copy(granted = false, revision = state.value.revision + 1)
            granted
        }
        if (wasGranted) onRevoked()
    }

    fun revokeIfCurrent(token: String, revision: Long) {
        val wasGranted = synchronized(this) {
            if (state.value.token != token || state.value.revision != revision) false
            else {
                val granted = state.value.granted
                state.value = state.value.copy(granted = false, revision = state.value.revision + 1)
                granted
            }
        }
        if (wasGranted) onRevoked()
    }

    @Synchronized fun allows(token: String): Boolean = state.value.let { it.token == token && it.granted }

    @Synchronized fun bind(token: String): () -> Boolean {
        val revision = state.value.revision
        return { synchronized(this) { state.value.let { it.token == token && it.granted && it.revision == revision } } }
    }
}
