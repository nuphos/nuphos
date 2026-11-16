package ai.nuphos.android.model

import ai.nuphos.android.data.JsonValue

/** Attribution is read only from the transcript's metadata, never its text parts. */
data class MessageAttribution(
    val id: String,
    val name: String,
    val type: String,
    val source: String,
    val viaName: String? = null,
    val avatarURL: String? = null,
    /** A channel's wake-up: the newest post it brought, for the line people see; null keeps today's line. */
    val channelPost: ChannelPostPreview? = null,
) {
    val label: String get() = viaName?.let { "$name · via $it" } ?: name
    val isEvent: Boolean get() = source == "agent.thread" || source == "agent.resource"
    /** A channel's wake-up notice to its agent (`channel-wake.ts`): the channel's id, else null. */
    val channelId: String? get() =
        if (source == "agent.resource" && id.startsWith(CHANNEL_PREFIX)) id.removePrefix(CHANNEL_PREFIX).takeIf { it.isNotEmpty() } else null

    companion object {
        private const val CHANNEL_PREFIX = "channel:"
        private val sources = setOf("nuphos", "slack", "discord", "lark", "agent.thread", "agent.resource")

        fun parse(metadata: JsonValue?): MessageAttribution? {
            if (metadata?.get("version")?.numberValue != 1.0) return null
            val source = metadata["source"]?.stringValue?.takeIf { it in sources } ?: return null
            if (metadata["sentAt"]?.stringValue == null) return null
            val sender = metadata["sender"] ?: return null
            val id = sender["id"]?.stringValue?.takeIf { it.isNotEmpty() } ?: return null
            val name = sender["displayName"]?.stringValue ?: return null
            val via = sender["onBehalfOf"]?.takeIf {
                source == "nuphos" && !it["id"]?.stringValue.isNullOrEmpty()
            }
            val expected = when {
                source == "agent.thread" || via != null -> "agent"
                source == "agent.resource" -> "system"
                else -> "user"
            }
            if (sender["type"]?.stringValue != expected) return null
            val viaName = via?.get("displayName")?.stringValue?.takeIf { it.isNotEmpty() }
            val post = if (source == "agent.resource" && id.startsWith(CHANNEL_PREFIX)) ChannelPostPreview.parse(metadata["channelPost"]) else null
            return MessageAttribution(id, name, expected, source, viaName, SenderAvatar.trusted(sender["avatarURL"]?.stringValue), post)
        }
    }
}

/** The newest post a channel's wake-up brought (`channel-newest-post.ts`): who, its first line or file name, how many more. */
data class ChannelPostPreview(
    val id: String,
    val name: String,
    val avatarURL: String?,
    /** Set for an agent's post: its avatar is the agent's face. */
    val agentId: String?,
    val runtime: String?,
    val text: String,
    val more: Int,
) {
    companion object {
        fun parse(value: JsonValue?): ChannelPostPreview? {
            val id = value?.get("id")?.stringValue?.takeIf { it.isNotEmpty() } ?: return null
            val text = value["text"]?.stringValue ?: return null
            val more = value["more"]?.numberValue ?: return null
            val sender = value["sender"] ?: return null
            val senderId = sender["id"]?.stringValue?.takeIf { it.isNotEmpty() } ?: return null
            val name = sender["displayName"]?.stringValue ?: return null
            val agent = sender["type"]?.stringValue == "agent"
            return ChannelPostPreview(id, name, SenderAvatar.trusted(sender["avatarURL"]?.stringValue),
                senderId.takeIf { agent }, sender["agentRuntime"]?.stringValue?.takeIf { agent }, text, maxOf(0, more.toInt()))
        }
    }
}

/** The post a channel opens at, by channel: set just before a wake-up's line opens it. */
object ChannelPostJump {
    val pending = mutableMapOf<String, String>()
}
