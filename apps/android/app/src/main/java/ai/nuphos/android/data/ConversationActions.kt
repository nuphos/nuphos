package ai.nuphos.android.data

import java.nio.charset.StandardCharsets

object ConversationActions {
    data class Favorites(val entries: List<JsonValue>, val revision: Long, val teamId: String? = null) {
        fun contains(sessionId: String) = entries.any { favoriteSessionId(it, teamId) == sessionId }
    }
    /** Same explicit key / Desktop chat-href identity used by iOS SidebarFavorites. */
    fun favoriteSessionId(entry: JsonValue, teamId: String? = null): String? {
        val key = entry["key"]?.stringValue
        if (key?.startsWith("agent-session:") == true)
            return key.removePrefix("agent-session:").takeIf { it.isNotBlank() }
        return try {
            val href = entry["href"]?.stringValue ?: return null
            val uri = java.net.URI(href)
            if (uri.rawQuery != null || uri.rawFragment != null || uri.isOpaque) return null
            if (uri.isAbsolute) {
                if (!uri.scheme.equals("https", ignoreCase = true) || !uri.host.equals("nuphos.ai", ignoreCase = true) ||
                    uri.rawUserInfo != null || uri.port !in listOf(-1, 443)) return null
            } else if (uri.rawAuthority != null) return null
            val parts = uri.rawPath?.split('/') ?: return null
            if (parts.size != 5 || parts[0].isNotEmpty() || parts[1] != "teams" ||
                parts[2].isEmpty() || parts[3] != "agent" || parts[4].isEmpty()) return null
            val hrefTeam = java.net.URLDecoder.decode(parts[2].replace("+", "%2B"), StandardCharsets.UTF_8.name())
            if (teamId != null && hrefTeam != teamId) return null
            java.net.URLDecoder.decode(parts[4].replace("+", "%2B"), StandardCharsets.UTF_8.name())
                .takeIf { it.isNotBlank() }
        } catch (_: IllegalArgumentException) { null }
          catch (_: java.net.URISyntaxException) { null }
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
    fun pinnedEntries(entries: List<JsonValue>, sessionId: String, title: String, pinned: Boolean, teamId: String? = null): List<JsonValue> {
        val key = "agent-session:$sessionId"
        val exists = entries.any { favoriteSessionId(it, teamId) == sessionId }
        if (!pinned) return entries.filterNot { favoriteSessionId(it, teamId) == sessionId }
        if (exists) return entries
        require(entries.size < 1000) { "Favorites are full." }
        return entries + JsonValue.obj("label" to JsonValue.Str(title.ifBlank { "Agent" }.take(200)), "key" to JsonValue.Str(key))
    }
    private fun decode(text: String, team: String): Favorites {
        val json = JsonValue.parse(text) ?: throw NuphosApi.Failure.InvalidResponse
        val entries = json["entries"]?.arrayValue ?: throw NuphosApi.Failure.InvalidResponse
        val revision = json["revision"]?.numberValue ?: throw NuphosApi.Failure.InvalidResponse
        require(revision >= 0 && revision % 1.0 == 0.0) { "Invalid favorites revision." }
        return Favorites(entries, revision.toLong(), team)
    }
    suspend fun favorites(token: String, team: String) = decode(AgentChatApi.send("GET", "teams/${segment(team)}/favorites", token), team)
    suspend fun pin(token: String, team: String, session: String, title: String, pinned: Boolean,
        request: suspend (String, String, String, List<Pair<String, String>>, JsonValue?) -> String = AgentChatApi::send,
    ): Favorites {
        val path = "teams/${segment(team)}/favorites"
        var current = decode(request("GET", path, token, emptyList(), null), team)
        repeat(2) { attempt ->
            val entries = pinnedEntries(current.entries, session, title, pinned, team)
            if (entries == current.entries) return current
            try {
                return decode(request("PUT", path, token, emptyList(), JsonValue.obj(
                    "expectedRevision" to JsonValue.Number(current.revision.toDouble()), "entries" to JsonValue.Arr(entries))), team)
            } catch (e: AgentChatApi.Conflict.Other) {
                if (e.code != "sidebar_favorites_changed" || attempt == 1) throw e
                current = decode(request("GET", path, token, emptyList(), null), team)
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
