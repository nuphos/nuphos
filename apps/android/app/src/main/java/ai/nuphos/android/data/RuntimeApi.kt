package ai.nuphos.android.data

object RuntimeApi {
    fun definitelyRejected(error: Throwable): Boolean = when (error) {
        is AgentChatApi.Conflict.Other -> error.status in 400..499 && error.status != 408
        is AgentChatApi.Conflict.TranscriptOutOfSync, AgentChatApi.Conflict.StreamNotResumable, NuphosApi.Failure.Unauthorized -> true
        else -> false
    }

    suspend fun steer(token: String, teamId: String, sessionId: String, text: String): String {
        val response = JsonValue.parse(AgentChatApi.send("POST", "agent/conversations/$sessionId/steer", token,
            listOf("teamId" to teamId), JsonValue.obj("text" to JsonValue.Str(text))))
        if (response?.get("ok")?.boolValue != true) throw NuphosApi.Failure.InvalidResponse
        return response["messageId"]?.stringValue ?: throw NuphosApi.Failure.InvalidResponse
    }
    suspend fun cancel(token: String, teamId: String, sessionId: String) {
        val response = JsonValue.parse(AgentChatApi.send("POST", "agent/conversations/$sessionId/cancel-runtime", token, listOf("teamId" to teamId)))
        if (response?.get("ok")?.boolValue != true || response["status"]?.stringValue != "requested") throw NuphosApi.Failure.InvalidResponse
    }
}
