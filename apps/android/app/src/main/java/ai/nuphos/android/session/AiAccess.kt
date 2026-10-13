package ai.nuphos.android.session

import androidx.compose.runtime.mutableStateOf

/** Account consent with a revision that invalidates retained session capabilities. */
object AiAccess {
    private data class Access(val token: String? = null, val granted: Boolean = false, val revision: Long = 0)
    private val state = mutableStateOf(Access())

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

    @Synchronized fun revoke() {
        state.value = state.value.copy(granted = false, revision = state.value.revision + 1)
    }

    @Synchronized fun revokeIfCurrent(token: String, revision: Long) {
        if (state.value.token == token && state.value.revision == revision) revoke()
    }

    @Synchronized fun allows(token: String): Boolean = state.value.let { it.token == token && it.granted }

    @Synchronized fun bind(token: String): () -> Boolean {
        val revision = state.value.revision
        return { synchronized(this) { state.value.let { it.token == token && it.granted && it.revision == revision } } }
    }
}
