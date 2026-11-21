package ai.nuphos.android.data

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import kotlinx.serialization.Serializable

/** Shared with Desktop and iOS. Non-session favorites must survive a pin edit. */
@Serializable
data class SidebarFavorites(val entries: List<Entry>, val revision: Long) {
    @Serializable
    data class Entry(val label: String, val key: String? = null, val href: String? = null) {
        val sessionId: String? get() {
            key?.takeIf { it.startsWith("agent-session:") }?.let {
                return it.removePrefix("agent-session:").takeIf(String::isNotEmpty)
            }
            val path = runCatching { URI(href ?: return null).rawPath }.getOrNull() ?: return null
            val parts = path.split('/')
            if (parts.size != 5 || parts[0].isNotEmpty() || parts[1] != "teams" ||
                parts[2].isEmpty() || parts[3] != "agent") return null
            return runCatching { URLDecoder.decode(parts[4].replace("+", "%2B"), "UTF-8") }
                .getOrNull()?.takeIf(String::isNotEmpty)
        }

        internal val json: JsonValue get() = JsonValue.Obj(buildMap {
            put("label", JsonValue.Str(label))
            key?.let { put("key", JsonValue.Str(it)) }
            href?.let { put("href", JsonValue.Str(it)) }
        })
    }

    fun settingPinned(team: String, session: String, label: String, pinned: Boolean): SidebarFavorites {
        val rest = entries.filter { it.sessionId != session }
        return copy(entries = if (pinned) rest + Entry(label,
            href = "/teams/${favoriteSegment(team)}/agent/${favoriteSegment(session)}") else rest)
    }
}

private fun favoriteSegment(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

object SidebarFavoritesApi {
    suspend fun read(token: String, team: String,
        send: suspend (String, String, String, List<Pair<String, String>>, JsonValue?) -> String = AgentChatApi::send,
    ): SidebarFavorites {
        val raw = send("GET", "teams/${favoriteSegment(team)}/favorites", token, emptyList(), null)
        return Http.json.decodeFromString<SidebarFavorites>(raw).also { require(it.revision >= 0) }
    }

    suspend fun write(token: String, team: String, favorites: SidebarFavorites,
        send: suspend (String, String, String, List<Pair<String, String>>, JsonValue?) -> String = AgentChatApi::send,
    ) {
        require(favorites.revision >= 0)
        send("PUT", "teams/${favoriteSegment(team)}/favorites", token, emptyList(), JsonValue.obj(
            "expectedRevision" to JsonValue.Number(favorites.revision.toDouble()),
            "entries" to JsonValue.Arr(favorites.entries.map { it.json }),
        ))
    }
}
