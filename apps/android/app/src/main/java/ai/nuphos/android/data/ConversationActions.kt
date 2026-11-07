package ai.nuphos.android.data

import java.nio.charset.StandardCharsets

object ConversationActions {
    fun shareUrl(teamId: String, sessionId: String): String? =
        if (teamId.isEmpty() || sessionId.isEmpty()) null else "https://nuphos.ai/teams/${segment(teamId)}/agent/${segment(sessionId)}"

    internal fun segment(value: String): String = buildString {
        for (byte in value.toByteArray(StandardCharsets.UTF_8)) {
            val c = (byte.toInt() and 255).toChar()
            if (c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c in "-_.!~*'()") append(c)
            else append("%%%02X".format(byte.toInt() and 255))
        }
    }
    fun validTitle(value: String): String? = value.trim().takeIf { it.length in 1..120 }
    suspend fun rename(token: String, team: String, session: String, title: String): String {
        val valid = requireNotNull(validTitle(title)) { "Title must contain 1–120 characters." }
        val json = JsonValue.parse(AgentChatApi.send("PATCH", "agent/conversations/${segment(session)}/title", token,
            listOf("teamId" to team), JsonValue.obj("teamId" to JsonValue.Str(team), "title" to JsonValue.Str(valid))))
        return json?.get("title")?.stringValue ?: throw NuphosApi.Failure.InvalidResponse
    }
    /** Same owner-only contract as iOS; never deletes the conversation itself. */
    suspend fun unlinkParent(token: String, team: String, session: String,
        request: suspend (String, String, String, List<Pair<String, String>>, JsonValue?) -> String = AgentChatApi::send,
    ) {
        val response = JsonValue.parse(request("DELETE", "agent/conversations/${segment(session)}/parent", token,
            listOf("teamId" to team), null))
        require(response?.get("ok")?.boolValue == true && response["parentSessionId"] == JsonValue.Null) {
            "Unlink was not confirmed."
        }
    }
    /** Read access is sufficient; notification permission remains independent. */
    suspend fun watch(token: String, team: String, session: String, watching: Boolean,
        request: suspend (String, String, String, List<Pair<String, String>>, JsonValue?) -> String = AgentChatApi::send,
    ): Boolean {
        val response = JsonValue.parse(request(if (watching) "PUT" else "DELETE",
            "agent/conversations/${segment(session)}/watch", token, listOf("teamId" to team), null))
        require(response?.get("ok")?.boolValue == true && response["watching"]?.boolValue == watching) {
            "Watch change was not confirmed. Try again."
        }
        return watching
    }
    suspend fun archive(token: String, team: String, session: String, archived: Boolean) {
        val json = JsonValue.parse(AgentChatApi.send("PATCH", "agent/conversations/${segment(session)}/archive", token,
            listOf("teamId" to team), JsonValue.obj("teamId" to JsonValue.Str(team), "archived" to JsonValue.Bool(archived))))
        require(json?.get("ok")?.boolValue == true && json["archived"]?.boolValue == archived) { "Archive was not confirmed." }
    }
}
