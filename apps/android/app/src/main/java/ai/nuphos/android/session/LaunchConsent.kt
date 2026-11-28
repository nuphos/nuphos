package ai.nuphos.android.session

import android.content.Context
import androidx.core.content.edit
import ai.nuphos.android.data.AccountApi
import java.security.MessageDigest

/**
 * The AI consent this device last saw the server accept, so a launch can open Home before the
 * server answers again. One record, for one login: a token fingerprint, never the token itself.
 * The server still checks consent on every request, and the launch reads it again at once.
 */
class LaunchConsent(private val store: Store) {
    interface Store {
        fun read(): String?
        fun write(value: String?)
    }

    /** Whether [token], signed in as [userId], last accepted the notice this build shows. */
    fun accepted(token: String, userId: String): Boolean =
        store.read() == record(token, userId, AccountApi.AI_CONSENT_VERSION)

    fun remember(token: String, userId: String, version: String) {
        if (version == AccountApi.AI_CONSENT_VERSION) store.write(record(token, userId, version)) else clear()
    }

    fun clear() = store.write(null)

    private fun record(token: String, userId: String, version: String) = listOf(fingerprint(token), userId, version).joinToString("\n")

    companion object {
        private const val KEY = "accepted"

        fun preferences(context: Context): LaunchConsent {
            val prefs = context.getSharedPreferences("nuphos.launch-consent", Context.MODE_PRIVATE)
            return LaunchConsent(object : Store {
                override fun read() = prefs.getString(KEY, null)
                override fun write(value: String?) = prefs.edit { if (value == null) remove(KEY) else putString(KEY, value) }
            })
        }

        private fun fingerprint(token: String) = MessageDigest.getInstance("SHA-256")
            .digest(token.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
