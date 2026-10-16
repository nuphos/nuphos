package ai.nuphos.android.session

import androidx.compose.runtime.mutableStateMapOf

/** Text drafts scoped to an authenticated account, workspace and composer destination. */
class ComposerDrafts(private val persistence: Persistence? = null) {
    sealed interface Destination {
        data object NewChat : Destination
        data class Chat(val sessionId: String) : Destination
    }
    data class Key(val accountId: String, val teamId: String, val destination: Destination)
    interface Persistence {
        fun load(accountId: String): Map<Key, String>
        fun write(key: Key, text: String)
        fun clear()
    }
    private val texts = mutableStateMapOf<Key, String>()
    private var accountId: String? = null
    private var generation = 0L

    @Synchronized fun onIdentity(id: String?) {
        if (accountId != id) {
            // Initial authenticated restore must retain on-disk drafts. Identity
            // replacement/sign-out must discard all persisted identities.
            if (accountId != null) clear()
            else { generation++; texts.clear() }
            accountId = id
            if (id != null) texts.putAll(persistence?.load(id).orEmpty().filterKeys { it.accountId == id })
        }
    }
    @Synchronized fun clear() {
        generation++
        persistence?.clear()
        texts.clear()
    }

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
            persistence?.write(key, text)
            true
        }
        fun submitted(accepted: Boolean, submittedText: String): Boolean = synchronized(this@ComposerDrafts) {
            if (!accepted || !valid()) return@synchronized false
            if (text == submittedText) { texts.remove(key); persistence?.write(key, "") }
            true
        }
    }
}
