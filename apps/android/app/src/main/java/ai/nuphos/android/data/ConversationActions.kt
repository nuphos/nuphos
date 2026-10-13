package ai.nuphos.android.data

import java.nio.charset.StandardCharsets

object ConversationActions {
    data class Favorites(val entries: List<JsonValue>, val revision: Long) {
        fun contains(sessionId: String) = entries.any { it["key"]?.stringValue == "agent-session:$sessionId" }
    }
    fun shareUrl(teamId: String, sessionId: String): String? =
        if (teamId.isEmpty() || sessionId.isEmpty()) null else "https://nuphos.ai/teams/${segment(teamId)}/agent/${segment(sessionId)}"

    private fun segment(value: String): String = buildString {
        for (byte in value.toByteArray(StandardCharsets.UTF_8)) {
            val c = (byte.toInt() and 255).toChar()
            if (c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c in "-_.!~*'()") append(c)
            else append("%%%02X".format(byte.toInt() and 255))
        }
    }
    fun validTitle(value: String): String? = value.trim().takeIf { it.length in 1..120 }
    fun pinnedEntries(entries: List<JsonValue>, sessionId: String, title: String, pinned: Boolean): List<JsonValue> {
        val key = "agent-session:$sessionId"
        val exists = entries.any { it["key"]?.stringValue == key }
        if (!pinned) return entries.filterNot { it["key"]?.stringValue == key }
        if (exists) return entries
        require(entries.size < 1000) { "Favorites are full." }
        return entries + JsonValue.obj("label" to JsonValue.Str(title.ifBlank { "Chat" }.take(200)), "key" to JsonValue.Str(key))
    }
    private fun decode(text: String): Favorites {
        val json = JsonValue.parse(text) ?: throw NuphosApi.Failure.InvalidResponse
        val entries = json["entries"]?.arrayValue ?: throw NuphosApi.Failure.InvalidResponse
        val revision = json["revision"]?.numberValue ?: throw NuphosApi.Failure.InvalidResponse
        require(revision >= 0 && revision % 1.0 == 0.0) { "Invalid favorites revision." }
        return Favorites(entries, revision.toLong())
    }
    suspend fun favorites(token: String, team: String) = decode(AgentChatApi.send("GET", "teams/${segment(team)}/favorites", token))
    suspend fun pin(token: String, team: String, session: String, title: String, pinned: Boolean,
        request: suspend (String, String, String, List<Pair<String, String>>, JsonValue?) -> String = AgentChatApi::send,
    ): Favorites {
        val path = "teams/${segment(team)}/favorites"
        var current = decode(request("GET", path, token, emptyList(), null))
        repeat(2) { attempt ->
            val entries = pinnedEntries(current.entries, session, title, pinned)
            if (entries == current.entries) return current
            try {
                return decode(request("PUT", path, token, emptyList(), JsonValue.obj(
                    "expectedRevision" to JsonValue.Number(current.revision.toDouble()), "entries" to JsonValue.Arr(entries))))
            } catch (e: AgentChatApi.Conflict.Other) {
                if (e.code != "sidebar_favorites_changed" || attempt == 1) throw e
                current = decode(request("GET", path, token, emptyList(), null))
            }
        }
        error("Favorites changed; try again.")
    }
    suspend fun rename(token: String, team: String, session: String, title: String): String {
        val valid = requireNotNull(validTitle(title)) { "Title must contain 1–120 characters." }
        val json = JsonValue.parse(AgentChatApi.send("PATCH", "agent/conversations/${segment(session)}/title", token,
            listOf("teamId" to team), JsonValue.obj("teamId" to JsonValue.Str(team), "title" to JsonValue.Str(valid))))
        return json?.get("title")?.stringValue ?: throw NuphosApi.Failure.InvalidResponse
    }
    suspend fun archive(token: String, team: String, session: String, archived: Boolean) {
        val json = JsonValue.parse(AgentChatApi.send("PATCH", "agent/conversations/${segment(session)}/archive", token,
            listOf("teamId" to team), JsonValue.obj("teamId" to JsonValue.Str(team), "archived" to JsonValue.Bool(archived))))
        require(json?.get("ok")?.boolValue == true && json["archived"]?.boolValue == archived) { "Archive was not confirmed." }
    }
}
