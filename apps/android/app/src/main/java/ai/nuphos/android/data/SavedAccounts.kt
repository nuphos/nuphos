package ai.nuphos.android.data

import ai.nuphos.android.model.NuphosUser
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** A signed-in account kept on this device. A null token means it must sign in again. */
@Serializable
data class SavedAccount(val origin: String, val user: NuphosUser, val token: String? = null) {
    val id: String get() = "$origin|${user.id}"
}

/**
 * The accounts list mirrors iOS: keyed by server and server-verified user ID.
 * The active account is the one whose token is the current session, so there
 * is no separate selection to keep in step.
 */
object SavedAccounts {
    private val json = Json { ignoreUnknownKeys = true }

    fun decode(raw: String?): List<SavedAccount> =
        raw?.let { runCatching { json.decodeFromString<List<SavedAccount>>(it) }.getOrNull() }.orEmpty()

    fun encode(accounts: List<SavedAccount>): String = json.encodeToString(accounts)

    /** Adds or refreshes an account; a token can only ever belong to one account. */
    fun remember(accounts: List<SavedAccount>, origin: String, user: NuphosUser, token: String): List<SavedAccount> {
        val account = SavedAccount(origin, user, token)
        val others = accounts.map { if (it.token == token && it.id != account.id) it.copy(token = null) else it }
        val index = others.indexOfFirst { it.id == account.id }
        return if (index < 0) others + account else others.toMutableList().also { it[index] = account }
    }

    /** Keeps the account listed but asks it to sign in again. */
    fun expire(accounts: List<SavedAccount>, token: String): List<SavedAccount> =
        accounts.map { if (it.token == token) it.copy(token = null) else it }

    fun forget(accounts: List<SavedAccount>, id: String): List<SavedAccount> = accounts.filter { it.id != id }
}
