package ai.nuphos.android.notifications

import android.graphics.Bitmap
import ai.nuphos.android.model.BotAvatars
import ai.nuphos.android.model.RuntimeIdentity

/**
 * Who a notification speaks for, as iOS shows it: a Bot's face on its picked tint with its
 * runtime's badge, or a Task's runtime mark (no face).
 */
data class NotificationSender(
    val name: String,
    val avatarFile: String?,
    val provider: String? = null,
    val background: String? = null,
) {
    companion object {
        /**
         * Only a face the app bundles and a runtime it has a logo for; an unknown tint paints white. A Bot whose
         * face is unknown, or a Task whose runtime has no logo, stays a plain notification.
         */
        fun from(data: Map<String, String>): NotificationSender? {
            val name = data["title"]?.trim()?.takeIf { it.isNotEmpty() }?.take(100) ?: return null
            val provider = { key: String -> data[key]?.takeIf { RuntimeIdentity.logo(it) != null } }
            val avatar = data["botAvatar"] ?: return provider("taskProvider")?.let { NotificationSender(name, null, it) }
            val file = BotAvatars.named(avatar) ?: return null
            return NotificationSender(name, file, provider("botProvider"), data["botBackground"])
        }
    }
}

/** A sender whose face is already rendered, ready to post. */
class NotificationFace(val name: String, val bitmap: Bitmap)
