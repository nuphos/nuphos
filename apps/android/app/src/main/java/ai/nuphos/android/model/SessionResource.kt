package ai.nuphos.android.model

import kotlinx.serialization.Serializable
import java.net.URI

/** Read-only projection of the existing conversation resources endpoint. */
@Serializable
data class SessionResource(
    val id: String,
    val provider: String,
    val title: String,
    val url: String,
    val state: String,
    val stateType: String? = null,
    val repository: String? = null,
    val number: Int? = null,
) {
    val chip: String get() = number?.let { "#$it" } ?: title.substringBefore(' ')
    val providerLabel: String get() = if (provider == "github") "GitHub" else "Linear"
    val safeUrl: String? get() = providerHttpsUrl(url)?.takeIf {
        val uri = URI(it)
        val host = when (provider) { "github" -> "github.com"; "linear" -> "linear.app"; else -> null }
        host != null && uri.port == -1 && uri.host.equals(host, ignoreCase = true)
    }
    val supported: Boolean get() = provider == "github" || provider == "linear"
}

@Serializable
data class SessionResourcesEnvelope(val resources: List<SessionResource>)
