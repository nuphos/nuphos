package ai.nuphos.android.session

import androidx.compose.runtime.mutableStateMapOf

/** Process-only text owned by one authenticated identity. No attachments or saved state. */
class ComposerDrafts {
    sealed interface Destination {
        data object NewChat : Destination
        data class Chat(val sessionId: String) : Destination
    }
    internal data class Key(val accountId: String, val teamId: String, val destination: Destination)
    private val texts = mutableStateMapOf<Key, String>()
    private var accountId: String? = null
    private var generation = 0L

    @Synchronized fun onIdentity(id: String?) {
        if (accountId != id) { clear(); accountId = id }
    }
    @Synchronized fun clear() { generation++; texts.clear() }

    @Synchronized fun bind(accountId: String, teamId: String?, destination: Destination, allowed: () -> Boolean = { true }): Lease? {
        if (teamId.isNullOrBlank() || accountId.isBlank()) return null
        if (this.accountId == null && generation == 0L) onIdentity(accountId)
        if (this.accountId != accountId) return null
        return Lease(Key(accountId, teamId, destination), generation, allowed)
    }

    inner class Lease internal constructor(private val key: Key, private val epoch: Long, private val allowed: () -> Boolean) {
        val text: String get() = synchronized(this@ComposerDrafts) { if (valid()) texts[key].orEmpty() else "" }
        private fun valid() = epoch == generation && key.accountId == accountId && allowed()
        fun write(text: String): Boolean = synchronized(this@ComposerDrafts) {
            if (!valid()) return@synchronized false
            if (text.isEmpty()) texts.remove(key) else texts[key] = text
            true
        }
        fun submitted(accepted: Boolean, submittedText: String): Boolean = synchronized(this@ComposerDrafts) {
            if (!accepted || !valid()) return@synchronized false
            if (text == submittedText) texts.remove(key)
            true
        }
    }
}
