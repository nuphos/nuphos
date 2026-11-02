package ai.nuphos.android.session

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.ChatPart

object RuntimeTranscript {
    fun userTurn(input: List<ChatMessage>, messages: List<ChatMessage>): List<ChatMessage> {
        val users = input.filter { it.role == ChatMessage.Role.User }
        if (users.isEmpty()) return messages
        val ids = users.map { it.id }.toSet()
        val first = messages.indexOfFirst { it.id in ids }
        val local = messages.associateBy { it.id }
        return (if (first >= 0) messages.take(first) else messages) + users.map { local[it.id]?.copy(metadata = it.metadata) ?: it }
    }
    fun autonomous(id: String, messages: List<ChatMessage>): List<ChatMessage> =
        if (messages.any { it.id == id }) messages else messages + ChatMessage(id = id, role = ChatMessage.Role.Assistant, parts = emptyList(), turnOrigin = "autonomous")

    fun steering(id: String, text: String, assistantId: String?, messages: List<ChatMessage>, metadata: JsonValue? = null): List<ChatMessage> {
        if (id.isBlank()) return messages
        val verified = metadata?.takeIf { ai.nuphos.android.model.MessageAttribution.parse(it) != null }
        val existingMessage = messages.indexOfFirst { message -> message.parts.any {
            it is ChatPart.Data && it.name == "steering" && it.data["id"]?.stringValue == id
        } }
        if (existingMessage >= 0) {
            if (verified == null) return messages
            return messages.mapIndexed { index, message ->
                if (index != existingMessage) message else message.copy(parts = message.parts.map { part ->
                    if (part is ChatPart.Data && part.name == "steering" && part.data["id"]?.stringValue == id &&
                        ai.nuphos.android.model.MessageAttribution.parse(part.data["metadata"]) == null
                    ) part.copy(data = JsonValue.Obj(part.data.objectValue.orEmpty() + ("metadata" to verified))) else part
                })
            }
        }
        return messages.map { message ->
            if (message.id == assistantId && message.role == ChatMessage.Role.Assistant) {
                val data = buildMap<String, JsonValue> {
                    put("id", JsonValue.Str(id)); put("text", JsonValue.Str(text))
                    verified?.let { put("metadata", it) }
                }
                message.copy(parts = message.parts + ChatPart.Data("steering", data = JsonValue.Obj(data)))
            } else message
        }
    }
}
