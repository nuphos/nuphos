package ai.nuphos.android.session

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.AgentRuntime
import ai.nuphos.android.data.RuntimeBinding

/** Application-owned IDs and uncertain-write receipts. No tokens or authorization secrets. */
class RuntimeSelections {
    private data class Key(val accountId: String, val teamId: String)
    private val selections = mutableMapOf<Key, Selection>()
    fun bind(accountId: String, teamId: String) = selections.getOrPut(Key(accountId, teamId)) { Selection(accountId, teamId) }
    fun clear() { selections.values.forEach { it.invalidate() }; selections.clear() }
    class Selection(val accountId: String, val teamId: String) {
        var catalog by mutableStateOf<List<AgentRuntime>>(emptyList())
            private set
        var selectedId by mutableStateOf<String?>(null)
            private set
        var valid by mutableStateOf(true)
            private set
        var createReview by mutableStateOf(false)
        var loginReview by mutableStateOf(false)
        var loginRuntimeId: String? = null
        var loginProvider: String? = null
        var loginAttemptId: String? = null
        val selected get() = catalog.firstOrNull { it.id == selectedId && it.selectable }
        val reselectionRequired get() = selectedId != null && selected == null
        val binding get() = selected?.let { RuntimeBinding(it.id, it.provider, it.label) }
        fun saveCatalog(saved: List<AgentRuntime>) { if (valid) catalog = saved }
        fun select(id: String): Boolean {
            if (!valid || catalog.none { it.id == id && it.selectable }) return false
            selectedId = id; return true
        }
        fun invalidate() { valid = false; catalog = emptyList(); selectedId = null; loginRuntimeId = null; loginProvider = null; loginAttemptId = null; createReview = false; loginReview = false }
    }
}
