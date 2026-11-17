package ai.nuphos.android.notifications

import ai.nuphos.android.model.BotAvatars

/** The Bot a notification speaks for: its name and a face this build ships, as iOS shows it. */
data class NotificationSender(val name: String, val avatarFile: String) {
    companion object {
        /** Only a face the server named and the app bundles; anything else stays a plain notification. */
        fun from(data: Map<String, String>): NotificationSender? {
            val file = data["botAvatar"]?.let(BotAvatars::named) ?: return null
            val name = data["title"]?.trim()?.takeIf { it.isNotEmpty() }?.take(100) ?: return null
            return NotificationSender(name, file)
        }
    }
}
