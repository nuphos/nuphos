package ai.nuphos.android.model

import ai.nuphos.android.data.JsonValue
import java.net.URI

enum class ConnectorFieldKind { Text, Secret, Url, Email, Guid, Arn, Region }
data class ConnectorField(
    val key: String,
    val title: String,
    val kind: ConnectorFieldKind = ConnectorFieldKind.Text,
    val required: Boolean = true,
    val max: Int = Int.MAX_VALUE,
    val trim: Boolean = true,
)
// Values are ephemeral. Do not put form input in saved state, logs, or disk storage.
class ConnectorValidation(val body: Map<String, String>, val errors: Map<String, String>) {
    val valid get() = errors.isEmpty()
    override fun toString() = "ConnectorValidation(valid=$valid)"
}
data class ConnectorProvider(
    val key: String,
    val title: String,
    val path: String? = null,
    val fields: List<ConnectorField> = emptyList(),
    val oauth: Boolean = false,
    val note: String? = null,
) {
    val canAdd get() = fields.isNotEmpty() || oauth || key == "github"
    val callbackHost get() = "$key-callback"

    fun validate(values: Map<String, String>): ConnectorValidation {
        val body = mutableMapOf<String, String>()
        val errors = mutableMapOf<String, String>()
        fields.forEach { field ->
            val raw = values[field.key].orEmpty()
            val value = if (field.trim) raw.trim() else raw
            if (value.isEmpty()) {
                if (field.required) errors[field.key] = "${field.title} is required."
                return@forEach
            }
            body[field.key] = value
            if (value.length > field.max) errors[field.key] = "Use at most ${field.max} characters."
            val valid = when (field.kind) {
                ConnectorFieldKind.Url -> validHttpUrl(value)
                ConnectorFieldKind.Email -> Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").matches(value)
                ConnectorFieldKind.Guid -> Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$").matches(value)
                ConnectorFieldKind.Arn -> Regex("^arn:aws:iam::[0-9]{12}:role/.+").matches(value)
                ConnectorFieldKind.Region -> value == "us" || value == "uk"
                else -> true
            }
            if (!valid) errors[field.key] = "Enter a valid ${field.title.lowercase()}."
        }
        if (key == "betterstack" && body["uptimeApiToken"] == null && body["telemetryApiToken"] == null) {
            errors["uptimeApiToken"] = "Provide at least one API token."
        }
        if (key == "uptimeKuma" && body["authToken"] == null && (body["username"] == null || body["password"] == null)) {
            errors["authToken"] = "Provide a token or both username and password."
        }
        return ConnectorValidation(body, errors)
    }
}

fun validHttpUrl(value: String): Boolean = runCatching {
    val uri = URI(value)
    uri.scheme in setOf("https", "http") && !uri.host.isNullOrBlank() && uri.userInfo == null
}.getOrDefault(false)

object ConnectorCatalog {
    val arrayKeys = listOf("aws", "gcp", "cloudflare", "linode", "hetzner", "tencent", "aliyun", "volcengine", "azure", "huawei", "vanta", "secureframe", "sonarqube", "notion", "onprem", "upstash", "resend", "posthog", "betterstack", "uptimeKuma", "tailscale", "zeabur", "github", "gitlab", "grafana", "linear", "jira", "asana", "sentry")
    private fun label() = ConnectorField("label", "Label", max = 100)
    private fun secret(key: String, title: String, max: Int = Int.MAX_VALUE, required: Boolean = true, trim: Boolean = true) = ConnectorField(key, title, ConnectorFieldKind.Secret, required, max, trim)
    private fun form(key: String, title: String, path: String, vararg fields: ConnectorField, note: String? = null) = ConnectorProvider(key, title, path, fields.toList(), note = note)
    val all = listOf(
        form("aws", "AWS", "aws-accounts", ConnectorField("roleArn", "Role ARN", ConnectorFieldKind.Arn, trim = false), note = "The role must already trust Nuphos. The server checks access before saving."),
        ConnectorProvider("gcp", "Google Cloud"),
        form("azure", "Azure", "azure-accounts", label(), ConnectorField("tenantId", "Tenant ID", ConnectorFieldKind.Guid), ConnectorField("clientId", "Client ID", ConnectorFieldKind.Guid), ConnectorField("subscriptionId", "Subscription ID", ConnectorFieldKind.Guid), note = "Set up the app's federated credential and role assignment first."),
        ConnectorProvider("cloudflare", "Cloudflare"),
        form("linode", "Linode", "linode-accounts", label(), secret("token", "API token")),
        form("hetzner", "Hetzner Cloud", "hetzner-accounts", label(), secret("token", "API token")),
        ConnectorProvider("tencent", "Tencent Cloud"), ConnectorProvider("aliyun", "Alibaba Cloud"), ConnectorProvider("volcengine", "Volcengine"),
        form("zeabur", "Zeabur", "zeabur-providers", secret("token", "API token")),
        ConnectorProvider("onprem", "Clusters"),
        form("betterstack", "Better Stack", "betterstack-integrations", label(), secret("uptimeApiToken", "Uptime API token", required = false), secret("telemetryApiToken", "Telemetry API token", required = false)),
        form("uptimeKuma", "Uptime Kuma", "uptime-kuma-instances", label(), ConnectorField("baseUrl", "Base URL", ConnectorFieldKind.Url), secret("authToken", "Auth token", required = false), ConnectorField("username", "Username", required = false, max = 255), secret("password", "Password", required = false, trim = false)),
        form("grafana", "Grafana", "grafana-instances", ConnectorField("name", "Name", max = 64, trim = false), ConnectorField("grafanaUrl", "Grafana URL", ConnectorFieldKind.Url, trim = false), secret("saToken", "Service account token", trim = false)),
        ConnectorProvider("sentry", "Sentry", "sentry-accounts", oauth = true),
        form("tailscale", "Tailscale", "tailscale-clients", label(), ConnectorField("clientId", "Client ID", max = 256), secret("clientSecret", "Client secret")),
        form("vanta", "Vanta", "vanta-integrations", label(), ConnectorField("clientId", "Client ID", max = 200), secret("clientSecret", "Client secret", 400)),
        form("secureframe", "Secureframe", "secureframe-integrations", label(), secret("apiKey", "API key", 200), secret("apiSecret", "API secret", 400), ConnectorField("region", "Region", ConnectorFieldKind.Region, required = false)),
        form("sonarqube", "SonarQube", "sonarqube-integrations", label(), ConnectorField("baseUrl", "Base URL", ConnectorFieldKind.Url), secret("token", "Token", 512)),
        ConnectorProvider("github", "GitHub", "github-installations"), ConnectorProvider("gitlab", "GitLab"),
        ConnectorProvider("linear", "Linear", "linear-workspaces", oauth = true), ConnectorProvider("jira", "Jira", "jira-sites", oauth = true), ConnectorProvider("asana", "Asana", "asana-accounts", oauth = true),
        form("notion", "Notion", "notion-integrations", label(), secret("token", "Integration token", 300)),
        form("upstash", "Upstash", "upstash-accounts", label(), ConnectorField("email", "Account email", ConnectorFieldKind.Email, max = 200), secret("apiKey", "Management API key", 400)),
        form("resend", "Resend", "resend-integrations", label(), secret("apiKey", "API key", 300)),
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
                    val label = listOf("label", "name", "alias", "accountLogin", "accountName", "projectId", "workspaceName", "username").firstNotNullOfOrNull { row[it]?.stringValue?.takeIf(String::isNotBlank) } ?: ConnectorCatalog.named(provider)?.title ?: provider
                    val detail = listOf("kind", "accountType", "siteUrl", "baseUrl", "grafanaUrl", "email", "accountId").firstNotNullOfOrNull { row[it]?.stringValue?.takeIf { value -> value.isNotBlank() && value != label } }
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
            if (linkedCount > 0) rows.add(ConnectorBinding("slack", "linked-channels", "slack:linked-channels", "Linked Slack channels", "$linkedCount linked channels"))
            val discord = json["discord"]
            val guild = discord?.get("installation")
            val guildId = guild?.get("guildId")?.stringValue
            if (!guildId.isNullOrBlank()) rows.add(ConnectorBinding("discord", guildId, "discord:$guildId", guild["guildName"]?.stringValue ?: "Discord", "${discord["channels"]?.arrayValue?.size ?: 0} linked channels"))
            return ConnectorInventory(rows.distinctBy { it.key })
        }
        fun createdIds(json: JsonValue): Set<String> = buildSet {
            bindingId(json)?.let(::add)
            json["providers"]?.arrayValue.orEmpty().forEach { bindingId(it)?.let(::add) }
        }
    }
}
