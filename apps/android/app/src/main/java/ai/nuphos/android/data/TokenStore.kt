package ai.nuphos.android.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Holds the session token across relaunches. Mirrors the iOS Keychain
 * wrapper: the token must never live in ordinary preferences if we can
 * avoid it.
 */
class TokenStore(context: Context) {
    private val prefs: SharedPreferences = runCatching {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }.getOrElse {
        context.getSharedPreferences(FALLBACK_FILE, Context.MODE_PRIVATE)
    }

    fun read(): String? = BackendOrigin.restore(prefs.getString(KEY, null), prefs.getString(ORIGIN_KEY, null))

    fun write(token: String) {
        prefs.edit().putString(KEY, token).putString(ORIGIN_KEY, BackendOrigin.forToken(token)).apply()
    }

    fun clear() {
        prefs.edit().remove(KEY).remove(ORIGIN_KEY).apply()
    }

    private val encrypted = prefs is EncryptedSharedPreferences

    /** Every account kept on this device, including the current one. */
    var accounts: List<SavedAccount>
        get() = SavedAccounts.decode(prefs.getString(ACCOUNTS_KEY, null))
        set(value) {
            val kept = if (encrypted) value else SavedAccounts.onlyCurrent(value, prefs.getString(KEY, null))
            prefs.edit().putString(ACCOUNTS_KEY, SavedAccounts.encode(kept)).apply()
        }

    companion object {
        private const val ACCOUNTS_KEY = "saved-accounts-v1"
        private const val FILE = "nuphos.secure"
        private const val FALLBACK_FILE = "nuphos.secure.fallback"
        private const val ORIGIN_KEY = "session-origin"
        private const val KEY = "session-token"
    }
}
