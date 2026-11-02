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
) {
    val label: String get() = viaName?.let { "$name · via $it" } ?: name
    val isEvent: Boolean get() = source == "agent.thread" || source == "agent.resource"

    companion object {
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
            return MessageAttribution(id, name, expected, source, viaName, SenderAvatar.trusted(sender["avatarURL"]?.stringValue))
        }
    }
}
