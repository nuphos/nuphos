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
    /** Merged or closed PRs and completed or canceled issues: worth knowing, no longer waiting on anyone. */
    val finished: Boolean get() =
        if (provider == "linear") stateType == "completed" || stateType == "canceled" else state == "merged" || state == "closed"
    private val mergedOrDone: Boolean get() = if (provider == "linear") stateType == "completed" else state == "merged"

    companion object {
        /**
         * What the chip folding the finished links says, as on Desktop: `13 merged`
         * (`2 done` when none is a PR), or `1 closed` when nothing merged.
         */
        fun finishedLabel(finished: List<SessionResource>): String {
            val merged = finished.filter { it.mergedOrDone }
            if (merged.isEmpty()) return "${finished.size} closed"
            return "${merged.size} ${if (merged.any { it.provider == "github" }) "merged" else "done"}"
        }
    }
}

/** Open links first, in the order they were linked; finished ones after them, as on Desktop. */
fun List<SessionResource>.openFirst(): Pair<List<SessionResource>, List<SessionResource>> = partition { !it.finished }

@Serializable
data class SessionResourcesEnvelope(val resources: List<SessionResource>)
