package ai.nuphos.android.session

import ai.nuphos.android.model.ConnectorCatalog
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import kotlinx.coroutines.flow.MutableStateFlow

// No provider credentials or authorization URL are stored in this record.
data class ConnectorPending(val teamId: String, val provider: String, val state: String, val expiresAt: Long)
sealed interface ConnectorReturn {
    data class OAuth(val bindingId: String) : ConnectorReturn
    data class Github(val installationId: Long) : ConnectorReturn
    data class Invalid(val message: String) : ConnectorReturn
}
object ConnectorCallback {
    val hosts = setOf("linear-callback", "jira-callback", "asana-callback", "sentry-callback", "github-callback")
    fun isConnectorUri(value: String): Boolean = runCatching { URI(value).let { it.scheme == "nuphos" && it.host in hosts } }.getOrDefault(false)
    fun state(value: String): String? = runCatching {
        URI(value).rawQuery.orEmpty().split('&').map { it.split('=', limit = 2) }
            .filter { URLDecoder.decode(it[0], StandardCharsets.UTF_8) == "state" }
            .singleOrNull()?.getOrNull(1)?.let { URLDecoder.decode(it, StandardCharsets.UTF_8) }
    }.getOrNull()
    fun validate(value: String, pending: ConnectorPending, now: Long): ConnectorReturn {
        fun invalid() = ConnectorReturn.Invalid("Authorization return is invalid or expired. Refresh connections and try again.")
        val uri = runCatching { URI(value) }.getOrNull() ?: return invalid()
        val provider = ConnectorCatalog.named(pending.provider) ?: return invalid()
        if (uri.scheme != "nuphos" || uri.host != provider.callbackHost || uri.userInfo != null || uri.port != -1 || !uri.path.isNullOrEmpty() || uri.fragment != null || now >= pending.expiresAt) return invalid()
        val query = runCatching {
            uri.rawQuery.orEmpty().split('&').filter(String::isNotEmpty).map { part ->
                val pair = part.split('=', limit = 2)
                URLDecoder.decode(pair[0], StandardCharsets.UTF_8) to URLDecoder.decode(pair.getOrElse(1) { "" }, StandardCharsets.UTF_8)
            }.groupBy({ it.first }, { it.second })
        }.getOrNull() ?: return invalid()
        fun single(key: String) = query[key]?.singleOrNull()
        if (single("state") != pending.state || query.values.any { it.size > 1 }) return invalid()
        if (query.containsKey("error")) return ConnectorReturn.Invalid("Provider authorization was not completed. Refresh connections before trying again.")
        if (provider.key == "github") {
            val action = single("setup_action") ?: "install"
            val rawId = single("installation_id") ?: return invalid()
            if (action !in setOf("install", "update") || !Regex("^[0-9]+$").matches(rawId)) return invalid()
            val id = rawId.toLongOrNull()?.takeIf { it > 0 && it <= 9007199254740991L } ?: return invalid()
            return ConnectorReturn.Github(id)
        }
        if (!provider.oauth || single("team_id") != pending.teamId) return invalid()
        val id = single("binding_id")?.takeIf(String::isNotBlank) ?: return invalid()
        return ConnectorReturn.OAuth(id)
    }
}

// Activity dispatch clears its Intent; the signed-in host consumes this single-use value.
object ConnectorIntents {
    val callback = MutableStateFlow<String?>(null)
    fun dispatch(uri: String): Boolean {
        if (!ConnectorCallback.isConnectorUri(uri)) return false
        callback.value = uri
        return true
    }
}
