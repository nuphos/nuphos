package ai.nuphos.android.model

import ai.nuphos.android.data.JsonValue
import java.net.URI

fun providerHttpsUrl(value: String?): String? = value?.let {
    runCatching { URI(it) }.getOrNull()?.takeIf { uri ->
        uri.scheme.equals("https", true) && !uri.host.isNullOrBlank() && uri.rawUserInfo == null
    }?.toASCIIString()
}

private fun JsonValue.text(key: String) = this[key]?.stringValue?.takeIf { it.isNotBlank() }

data class MonitoringRow(
    val id: String, val provider: String, val integrationId: String, val integrationLabel: String,
    val providerResourceId: String, val kind: String, val name: String, val status: String,
    val statusLabel: String, val target: String?, val lastIncidentAt: String?, val providerUrl: String?,
)
data class MonitoringProviderError(val provider: String, val integrationId: String, val integrationLabel: String, val message: String)
data class MonitoringOverview(val rows: List<MonitoringRow> = emptyList(), val providerErrors: List<MonitoringProviderError> = emptyList()) {
    companion object {
        fun decode(value: JsonValue): MonitoringOverview {
            require(value.objectValue != null && value["rows"]?.arrayValue != null) { "Invalid monitoring response" }
            val rows = value["rows"]?.arrayValue.orEmpty().mapNotNull { row ->
                val provider = row.text("provider") ?: return@mapNotNull null
                val integration = row.text("integrationId") ?: return@mapNotNull null
                val resource = row.text("providerResourceId") ?: return@mapNotNull null
                val kind = row.text("kind") ?: return@mapNotNull null
                val identity = listOf(provider, integration, kind, resource).joinToString(":") { "${it.length}:$it" }
                MonitoringRow(identity, provider, integration, row.text("integrationLabel") ?: integration,
                    resource, kind, row.text("name") ?: resource, row.text("status") ?: "unknown",
                    row.text("statusLabel") ?: "unknown", row.text("target"), row.text("lastIncidentAt"), providerHttpsUrl(row.text("providerUrl")))
            }.distinctBy { it.id }
            val errors = value["providerErrors"]?.arrayValue.orEmpty().mapNotNull { row ->
                val provider = row.text("provider") ?: return@mapNotNull null
                val integration = row.text("integrationId") ?: return@mapNotNull null
                MonitoringProviderError(provider, integration, row.text("integrationLabel") ?: integration, "Could not load this provider. Refresh to try again.")
            }
            return MonitoringOverview(rows, errors)
        }
    }
}
