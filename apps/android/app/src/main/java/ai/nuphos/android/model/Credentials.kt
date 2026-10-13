package ai.nuphos.android.model

import ai.nuphos.android.data.JsonValue
import kotlinx.serialization.Serializable

data class CredentialCatalog(
    val sections: List<Section>,
) {
    data class Provider(
        val optionsKey: String,
        val selectionKey: String,
        val title: String,
        val idKey: String,
        val labelKeys: List<String>,
        val detailKeys: List<String>,
    )

    data class Item(
        val provider: Provider,
        val id: String,
        val label: String,
        val detail: String?,
    )

    data class Section(val provider: Provider, val items: List<Item>)

    val isEmpty: Boolean get() = sections.isEmpty()
    val allItems: List<Item> get() = sections.flatMap { it.items }

    constructor(json: JsonValue) : this(
        PROVIDERS.mapNotNull { provider ->
            val rows = json[provider.optionsKey]?.arrayValue ?: emptyList()
            val items = rows.mapNotNull { row ->
                val id = row[provider.idKey]?.stringValue ?: return@mapNotNull null
                val label = provider.labelKeys.firstNotNullOfOrNull { row[it]?.stringValue?.takeIf { v -> v.isNotEmpty() } } ?: id
                val detail = provider.detailKeys.firstNotNullOfOrNull {
                    row[it]?.stringValue?.takeIf { v -> v.isNotEmpty() && v != label }
                }
                Item(provider, id, label, if (provider.optionsKey == "devices") detail?.let(::platformName) else detail)
            }
            if (items.isEmpty()) null else Section(provider, items)
        },
    )

    companion object {
        private fun platformName(platform: String) = when (platform) {
            "darwin" -> "macOS"
            "win32" -> "Windows"
            "linux" -> "Linux"
            else -> platform
        }

        val PROVIDERS = listOf(
            Provider("devices", "deviceIds", "My computers", "deviceId", listOf("label"), listOf("platform")),
            Provider("awsRoles", "awsRoleIds", "AWS", "roleId", listOf("accountAlias", "accountId"), listOf("roleArn")),
            Provider("gcpServiceAccounts", "gcpServiceAccountIds", "Google Cloud", "serviceAccountId", listOf("projectId"), listOf("serviceAccountEmail")),
            Provider("azureAccounts", "azureAccountIds", "Azure", "accountId", listOf("label"), listOf("subscriptionId")),
            Provider("linodeAccounts", "linodeAccountIds", "Linode", "accountId", listOf("label"), emptyList()),
            Provider("hetznerAccounts", "hetznerAccountIds", "Hetzner", "accountId", listOf("label"), emptyList()),
            Provider("tencentAccounts", "tencentAccountIds", "Tencent Cloud", "accountId", listOf("label"), listOf("roleArn")),
            Provider("aliyunAccounts", "aliyunAccountIds", "Alibaba Cloud", "accountId", listOf("label"), listOf("roleArn")),
            Provider("volcengineAccounts", "volcengineAccountIds", "Volcengine", "accountId", listOf("label"), listOf("roleTrn")),
            Provider("zeaburProviders", "zeaburIds", "Zeabur", "zeaburId", listOf("name"), listOf("kind")),
            Provider("onpremClusters", "onpremClusterIds", "Clusters", "clusterId", listOf("label"), listOf("contextName")),
            Provider("tailscaleClients", "tailscaleClientIds", "Tailscale", "clientId", listOf("label"), listOf("oauthClientId")),
            Provider("betterStackIntegrations", "betterStackIntegrationIds", "Better Stack", "integrationId", listOf("label"), emptyList()),
            Provider("uptimeKumaInstances", "uptimeKumaInstanceIds", "Uptime Kuma", "instanceId", listOf("label"), listOf("baseUrl")),
            Provider("sentryAccounts", "sentryAccountIds", "Sentry", "accountId", listOf("label"), listOf("userEmail")),
            Provider("linearWorkspaces", "linearWorkspaceIds", "Linear", "workspaceId", listOf("label", "workspaceName"), listOf("workspaceName")),
            Provider("jiraSites", "jiraSiteIds", "Jira", "siteId", listOf("label"), listOf("siteUrl")),
            Provider("asanaAccounts", "asanaAccountIds", "Asana", "accountId", listOf("label"), listOf("accountEmail")),
            Provider("vantaIntegrations", "vantaIntegrationIds", "Vanta", "integrationId", listOf("label"), emptyList()),
            Provider("secureframeIntegrations", "secureframeIntegrationIds", "Secureframe", "integrationId", listOf("label"), listOf("region")),
            Provider("resendIntegrations", "resendIntegrationIds", "Resend", "integrationId", listOf("label"), listOf("permission")),
        )
    }
}

@Serializable
data class CredentialSelection(
    val ids: Map<String, Set<String>> = emptyMap(),
) {
    val isEmpty: Boolean get() = ids.values.all { it.isEmpty() }
    val count: Int get() = ids.values.sumOf { it.size }

    fun contains(item: CredentialCatalog.Item): Boolean =
        ids[item.provider.selectionKey]?.contains(item.id) == true

    fun toggle(item: CredentialCatalog.Item): CredentialSelection {
        val set = (ids[item.provider.selectionKey] ?: emptySet()).toMutableSet()
        if (!set.add(item.id)) set.remove(item.id)
        return copy(ids = ids + (item.provider.selectionKey to set))
    }

    val json: JsonValue
        get() = JsonValue.Obj(
            CredentialCatalog.PROVIDERS.associate { provider ->
                provider.selectionKey to JsonValue.Arr(
                    (ids[provider.selectionKey] ?: emptySet()).sorted().map { JsonValue.Str(it) },
                )
            },
        )

    constructor(json: JsonValue) : this(
        CredentialCatalog.PROVIDERS.mapNotNull { provider ->
            val set = json[provider.selectionKey]?.arrayValue?.mapNotNull { it.stringValue }?.toSet().orEmpty()
            if (set.isEmpty()) null else provider.selectionKey to set
        }.toMap(),
    )

    fun pruned(catalog: CredentialCatalog): CredentialSelection {
        val valid = catalog.allItems.groupBy { it.provider.selectionKey }.mapValues { e -> e.value.map { it.id }.toSet() }
        return copy(ids = ids.mapValues { (key, set) -> set.intersect(valid[key] ?: emptySet()) })
    }
}

enum class PermissionMode(val raw: String, val title: String, val subtitle: String) {
    Auto("auto", "Auto Mode", "Risky commands ask for your approval"),
    Bypass("bypass", "Bypass Permissions", "Run every command without asking");

    companion object {
        fun from(raw: String?) = entries.firstOrNull { it.raw == raw } ?: Auto
    }
}
