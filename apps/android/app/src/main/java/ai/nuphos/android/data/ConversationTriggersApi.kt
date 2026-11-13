package ai.nuphos.android.data

import kotlinx.serialization.Serializable

@Serializable
data class ConversationTrigger(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val triggerType: String,
    val scheduleDescription: String? = null,
    val cronExpression: String? = null,
    val nextRunAt: String? = null,
    val canManage: Boolean = false,
) {
    val schedule: String get() = scheduleDescription ?: if (triggerType == "cron") "Schedule: ${cronExpression.orEmpty()} (UTC)" else "When a webhook arrives"
}

object ConversationTriggersApi {
    suspend fun list(token: String, team: String, session: String): List<ConversationTrigger> =
        Http.json.decodeFromString(AgentChatApi.send("GET", "agent/triggers", token,
            listOf("teamId" to team, "targetSessionId" to session)))

    suspend fun toggle(token: String, team: String, id: String, enabled: Boolean) {
        AgentChatApi.send("PATCH", "agent/triggers/$id", token, listOf("teamId" to team),
            JsonValue.obj("enabled" to JsonValue.Bool(enabled)))
    }
}
