package ai.nuphos.android.model

import ai.nuphos.android.R
import ai.nuphos.android.data.JsonValue
import androidx.annotation.StringRes
import java.net.URI

enum class ConnectorFieldKind { Text, Secret, Url, Email, Guid, Arn, Region }
data class ConnectorField(
    val key: String,
    @StringRes val title: Int,
    val kind: ConnectorFieldKind = ConnectorFieldKind.Text,
    val required: Boolean = true,
    val max: Int = Int.MAX_VALUE,
    val trim: Boolean = true,
)
// Values are ephemeral. Do not put form input in saved state, logs, or disk storage.
/** Why a field is not accepted; the form words it with the field's title. */
enum class ConnectorError { Required, TooLong, Invalid, NeedApiToken, NeedTokenOrLogin }
class ConnectorValidation(val body: Map<String, String>, val errors: Map<String, ConnectorError>) {
    val valid get() = errors.isEmpty()
    override fun toString() = "ConnectorValidation(valid=$valid)"
}
data class ConnectorProvider(
    val key: String,
    val title: String,
    val path: String? = null,
    val fields: List<ConnectorField> = emptyList(),
    val oauth: Boolean = false,
    @StringRes val note: Int? = null,
) {
    val category: String get() = when (key) {
        "aws", "gcp", "azure", "cloudflare", "linode", "hetzner", "tencent", "aliyun", "volcengine", "huawei", "zeabur", "onprem" -> "Infrastructure"
        "betterstack", "uptimeKuma", "grafana", "sentry", "posthog" -> "Observability"
        "tailscale" -> "Networking"
        "vanta", "secureframe", "sonarqube" -> "Compliance"
        "github", "gitlab" -> "Source control"
        "linear", "jira", "asana", "trello" -> "Project management"
        "notion", "plaud" -> "Document"
        "upstash" -> "Databases"
        "resend" -> "Email"
        else -> "Messaging"
    }
    val labelKeys: List<String> get() = when (key) {
        "aws" -> listOf("alias", "accountId")
        "gcp" -> listOf("projectId")
        "cloudflare" -> listOf("accountName", "label")
        "zeabur" -> listOf("name")
        "grafana" -> listOf("name")
        "github" -> listOf("accountLogin")
        "gitlab" -> listOf("username")
        "linear" -> listOf("label", "workspaceName")
        else -> listOf("label")
    }
    val detailKeys: List<String> get() = when (key) {
        "aws", "tencent", "aliyun" -> listOf("roleArn")
        "gcp" -> listOf("serviceAccountEmail")
        "azure" -> listOf("subscriptionId")
        "cloudflare" -> listOf("accountId")
        "volcengine" -> listOf("roleTrn")
        "zeabur" -> listOf("kind")
        "onprem" -> listOf("contextName")
        "uptimeKuma", "sonarqube" -> listOf("baseUrl")
        "grafana" -> listOf("grafanaUrl")
        "sentry", "plaud" -> listOf("userEmail")
        "tailscale" -> listOf("clientId")
        "secureframe" -> listOf("region")
        "github" -> listOf("accountType")
        "gitlab" -> listOf("hostUrl")
        "linear", "notion" -> listOf("workspaceName")
        "jira" -> listOf("siteUrl")
        "asana" -> listOf("accountEmail")
        "trello" -> listOf("username")
        "upstash" -> listOf("email")
        "resend" -> listOf("permission")
        else -> emptyList()
    }
    val canAdd get() = fields.isNotEmpty() || oauth || key == "github"
    val callbackHost get() = "$key-callback"

    fun validate(values: Map<String, String>): ConnectorValidation {
        val body = mutableMapOf<String, String>()
        val errors = mutableMapOf<String, ConnectorError>()
        fields.forEach { field ->
            val raw = values[field.key].orEmpty()
            val value = if (field.trim) raw.trim() else raw
            if (value.isEmpty()) {
                if (field.required) errors[field.key] = ConnectorError.Required
                return@forEach
            }
            body[field.key] = value
            if (value.length > field.max) errors[field.key] = ConnectorError.TooLong
            val valid = when (field.kind) {
                ConnectorFieldKind.Url -> validHttpUrl(value)
                ConnectorFieldKind.Email -> Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").matches(value)
                ConnectorFieldKind.Guid -> Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$").matches(value)
                ConnectorFieldKind.Arn -> Regex("^arn:aws:iam::[0-9]{12}:role/.+").matches(value)
                ConnectorFieldKind.Region -> value == "us" || value == "uk"
                else -> true
            }
            if (!valid) errors[field.key] = ConnectorError.Invalid
        }
        if (key == "betterstack" && body["uptimeApiToken"] == null && body["telemetryApiToken"] == null) {
            errors["uptimeApiToken"] = ConnectorError.NeedApiToken
        }
        if (key == "uptimeKuma" && body["authToken"] == null && (body["username"] == null || body["password"] == null)) {
            errors["authToken"] = ConnectorError.NeedTokenOrLogin
        }
        return ConnectorValidation(body, errors)
    }
}

fun validHttpUrl(value: String): Boolean = runCatching {
    val uri = URI(value)
    uri.scheme in setOf("https", "http") && !uri.host.isNullOrBlank() && uri.userInfo == null
}.getOrDefault(false)

object ConnectorCatalog {
    val categoryOrder = listOf("Infrastructure", "Observability", "Databases", "Networking", "Compliance", "Source control", "Project management", "Document", "Email", "Messaging", "Other")
    val arrayKeys = listOf("aws", "gcp", "cloudflare", "linode", "hetzner", "tencent", "aliyun", "volcengine", "azure", "huawei", "vanta", "secureframe", "sonarqube", "notion", "onprem", "upstash", "resend", "posthog", "betterstack", "uptimeKuma", "tailscale", "zeabur", "github", "gitlab", "grafana", "linear", "jira", "asana", "trello", "sentry", "plaud")
    private fun label() = ConnectorField("label", R.string.connectors_field_label, max = 100)
    private fun secret(key: String, @StringRes title: Int, max: Int = Int.MAX_VALUE, required: Boolean = true, trim: Boolean = true) = ConnectorField(key, title, ConnectorFieldKind.Secret, required, max, trim)
    private fun form(key: String, title: String, path: String, vararg fields: ConnectorField, @StringRes note: Int? = null) = ConnectorProvider(key, title, path, fields.toList(), note = note)
    val all = listOf(
        form("aws", "AWS", "aws-accounts", ConnectorField("roleArn", R.string.connectors_field_role_arn, ConnectorFieldKind.Arn, trim = false), note = R.string.connectors_note_aws),
        ConnectorProvider("gcp", "Google Cloud / Firebase"),
        form("azure", "Azure", "azure-accounts", label(), ConnectorField("tenantId", R.string.connectors_field_tenant_id, ConnectorFieldKind.Guid), ConnectorField("clientId", R.string.connectors_field_client_id, ConnectorFieldKind.Guid), ConnectorField("subscriptionId", R.string.connectors_field_subscription_id, ConnectorFieldKind.Guid), note = R.string.connectors_note_azure),
        ConnectorProvider("cloudflare", "Cloudflare"),
        form("linode", "Linode", "linode-accounts", label(), secret("token", R.string.connectors_field_api_token)),
        form("hetzner", "Hetzner Cloud", "hetzner-accounts", label(), secret("token", R.string.connectors_field_api_token)),
        ConnectorProvider("tencent", "Tencent Cloud"), ConnectorProvider("aliyun", "Alibaba Cloud"), ConnectorProvider("volcengine", "Volcengine"),
        form("zeabur", "Zeabur", "zeabur-providers", secret("token", R.string.connectors_field_api_token)),
        ConnectorProvider("onprem", "Clusters"),
        form("betterstack", "Better Stack", "betterstack-integrations", label(), secret("uptimeApiToken", R.string.connectors_field_uptime_api_token, required = false), secret("telemetryApiToken", R.string.connectors_field_telemetry_api_token, required = false)),
        form("uptimeKuma", "Uptime Kuma", "uptime-kuma-instances", label(), ConnectorField("baseUrl", R.string.connectors_field_base_url, ConnectorFieldKind.Url), secret("authToken", R.string.connectors_field_auth_token, required = false), ConnectorField("username", R.string.connectors_field_username, required = false, max = 255), secret("password", R.string.connectors_field_password, required = false, trim = false)),
        form("grafana", "Grafana", "grafana-instances", ConnectorField("name", R.string.connectors_field_name, max = 64, trim = false), ConnectorField("grafanaUrl", R.string.connectors_field_grafana_url, ConnectorFieldKind.Url, trim = false), secret("saToken", R.string.connectors_field_service_account_token, trim = false)),
        ConnectorProvider("sentry", "Sentry", "sentry-accounts", oauth = true),
        form("tailscale", "Tailscale", "tailscale-clients", label(), ConnectorField("clientId", R.string.connectors_field_client_id, max = 256), secret("clientSecret", R.string.connectors_field_client_secret)),
        form("vanta", "Vanta", "vanta-integrations", label(), ConnectorField("clientId", R.string.connectors_field_client_id, max = 200), secret("clientSecret", R.string.connectors_field_client_secret, 400)),
        form("secureframe", "Secureframe", "secureframe-integrations", label(), secret("apiKey", R.string.connectors_field_api_key, 200), secret("apiSecret", R.string.connectors_field_api_secret, 400), ConnectorField("region", R.string.connectors_field_region, ConnectorFieldKind.Region, required = false)),
        form("sonarqube", "SonarQube", "sonarqube-integrations", label(), ConnectorField("baseUrl", R.string.connectors_field_base_url, ConnectorFieldKind.Url), secret("token", R.string.connectors_field_token, 512)),
        ConnectorProvider("github", "GitHub", "github-installations"), ConnectorProvider("gitlab", "GitLab"),
        ConnectorProvider("linear", "Linear", "linear-workspaces", oauth = true), ConnectorProvider("jira", "Jira", "jira-sites", oauth = true), ConnectorProvider("asana", "Asana", "asana-accounts", oauth = true),
        ConnectorProvider("trello", "Trello", "trello-integrations", oauth = true),
        ConnectorProvider("plaud", "Plaud", "plaud-accounts", oauth = true),
        form("notion", "Notion", "notion-integrations", label(), secret("token", R.string.connectors_field_integration_token, 300)),
        form("upstash", "Upstash", "upstash-accounts", label(), ConnectorField("email", R.string.connectors_field_account_email, ConnectorFieldKind.Email, max = 200), secret("apiKey", R.string.connectors_field_management_api_key, 400)),
        form("resend", "Resend", "resend-integrations", label(), secret("apiKey", R.string.connectors_field_api_key, 300)),
        ConnectorProvider("huawei", "Huawei Cloud"), ConnectorProvider("posthog", "PostHog"), ConnectorProvider("slack", "Slack"), ConnectorProvider("lark", "Lark"), ConnectorProvider("discord", "Discord"),
    )
    fun named(key: String) = all.firstOrNull { it.key == key }
}

data class ConnectorBinding(val provider: String, val bindingId: String, val key: String, val label: String, val detail: String? = null, val installationId: Long? = null)
data class ConnectorInventory(val rows: List<ConnectorBinding> = emptyList()) {
    fun contains(provider: String, bindingId: String) = rows.any { it.provider == provider && it.bindingId == bindingId }
    companion object {
        private val idKeys = listOf("id", "roleId", "serviceAccountId", "accountId", "providerId", "installationId", "clusterId")
        fun bindingId(row: JsonValue): String? = idKeys.firstNotNullOfOrNull { row[it]?.stringValue?.takeIf(String::isNotBlank) }
        fun decode(json: JsonValue): ConnectorInventory {
            val rows = mutableListOf<ConnectorBinding>()
            ConnectorCatalog.arrayKeys.forEach { provider ->
                json[provider]?.arrayValue.orEmpty().forEach rowLoop@{ row ->
                    val id = bindingId(row) ?: return@rowLoop
                    val identity = if (provider == "zeabur") ":${row["zeaburId"]?.stringValue.orEmpty()}:${row["kind"]?.stringValue.orEmpty()}" else ""
                    val label = (ConnectorCatalog.named(provider)?.labelKeys.orEmpty() + listOf("label", "name", "alias", "accountLogin", "accountName", "projectId", "workspaceName", "username")).distinct().firstNotNullOfOrNull { row[it]?.stringValue?.takeIf(String::isNotBlank) } ?: ConnectorCatalog.named(provider)?.title ?: provider
                    val detail = (ConnectorCatalog.named(provider)?.detailKeys.orEmpty() + listOf("kind", "accountType", "siteUrl", "baseUrl", "grafanaUrl", "email", "accountId")).distinct().firstNotNullOfOrNull { row[it]?.stringValue?.takeIf { value -> value.isNotBlank() && value != label } }
                    rows.add(ConnectorBinding(provider, id, "$provider:$id$identity", label, detail, row["installationId"]?.numberValue?.toLong()))
                }
            }
            listOf("slack", "lark").forEach { provider ->
                val installation = json[provider]?.get("installation")
                val id = installation?.get("id")?.stringValue
                if (!id.isNullOrBlank()) {
                    val label = installation[if (provider == "slack") "slackTeamName" else "tenantName"]?.stringValue ?: ConnectorCatalog.named(provider)!!.title
                    rows.add(ConnectorBinding(provider, id, "$provider:$id", label))
                }
            }
            val linked = json["slack"]?.get("linkedChannels")
            val linkedCount = linked?.get("count")?.numberValue?.toInt() ?: linked?.arrayValue?.size ?: 0
            if (linkedCount > 0) rows.add(ConnectorBinding("slack", "linked-channels", "slack:linked-channels", Words(R.string.storetext_connectors_linked_slack), Words.plural(R.plurals.storetext_connectors_linked_channels, linkedCount, linkedCount)))
            val discord = json["discord"]
            val guild = discord?.get("installation")
            val guildId = guild?.get("guildId")?.stringValue
            if (!guildId.isNullOrBlank()) rows.add(ConnectorBinding("discord", guildId, "discord:$guildId", guild["guildName"]?.stringValue ?: "Discord", (discord["channels"]?.arrayValue?.size ?: 0).let { Words.plural(R.plurals.storetext_connectors_linked_channels, it, it) }))
            return ConnectorInventory(rows.distinctBy { it.key })
        }
        fun createdIds(json: JsonValue): Set<String> = buildSet {
            bindingId(json)?.let(::add)
            json["providers"]?.arrayValue.orEmpty().forEach { bindingId(it)?.let(::add) }
        }
    }
}
