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

    fun read(): String? = prefs.getString(KEY, null)

    fun write(token: String) {
        prefs.edit().putString(KEY, token).apply()
    }

    fun clear() {
        prefs.edit().remove(KEY).apply()
    }

    companion object {
        private const val FILE = "nuphos.secure"
        private const val FALLBACK_FILE = "nuphos.secure.fallback"
        private const val KEY = "session-token"
    }
}
