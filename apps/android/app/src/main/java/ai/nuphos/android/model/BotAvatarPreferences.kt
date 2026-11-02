package ai.nuphos.android.model

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** Local appearance only. No account request or credential is involved. */
class BotAvatarPreferences private constructor(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("appearance", Context.MODE_PRIVATE)
    var enabled by mutableStateOf(preferences.getBoolean("bot_avatars", true))
        private set

    fun update(enabled: Boolean) {
        preferences.edit().putBoolean("bot_avatars", enabled).apply()
        this.enabled = enabled
    }

    companion object {
        @Volatile private var instance: BotAvatarPreferences? = null
        fun get(context: Context): BotAvatarPreferences = instance ?: synchronized(this) {
            instance ?: BotAvatarPreferences(context).also { instance = it }
        }
    }
}
