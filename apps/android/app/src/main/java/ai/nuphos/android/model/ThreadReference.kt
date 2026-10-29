package ai.nuphos.android.model

import ai.nuphos.android.data.JsonValue
import java.util.UUID

data class ThreadReference(val id: String, val title: String?, val verb: String) {
    companion object {
        fun from(part: ChatPart.Tool): ThreadReference? {
            if (part.toolName !in setOf("create_thread", "send_message_to_thread") || part.state != ChatPart.Tool.State.OutputAvailable) return null
            fun valid(value: JsonValue?): String? = value?.stringValue?.takeIf {
                it.matches(Regex("[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")) && runCatching { UUID.fromString(it) }.isSuccess
            }
            fun receipt(value: JsonValue?, depth: Int = 0): JsonValue? {
                if (depth > 3) return null
                value?.stringValue?.let { return receipt(JsonValue.parse(it), depth + 1) }
                value?.arrayValue?.let { return receipt(it.firstOrNull { item -> item["type"]?.stringValue == "text" }?.get("text"), depth + 1) }
                return value
            }
            val id = valid(part.input?.get("threadId")) ?: valid(receipt(part.output)?.get("threadId")) ?: return null
            return ThreadReference(id, part.input?.get("title")?.stringValue?.trim()?.takeIf { it.isNotBlank() },
                if (part.toolName == "create_thread") "Started" else "Messaged")
        }
    }
}
