import Foundation

enum CredentialScope {
    case credentials, devices

    func includes(_ selectionKey: String) -> Bool {
        (selectionKey == "deviceIds") == (self == .devices)
    }
}

/// The credentials (IAM) a conversation may use — `GET /agent/credential-options`
/// on the way in, `credentialAccess` (`AgentCredentialSelection`) on the way
/// out. One table drives both, so a new provider is one row.
struct CredentialCatalog: Equatable, Sendable {
    struct Provider: Identifiable, Equatable, Sendable {
        /// Key in the options response (`awsRoles`).
        let optionsKey: String
        /// Key in the selection payload (`awsRoleIds`).
        let selectionKey: String
        let title: String
        /// Asset catalog image (`Logos/`), the desktop's `CloudLogo` mark.
        let logo: String
        let idKey: String
        /// Fields tried in order for the primary label.
        let labelKeys: [String]
        /// Fields tried in order for the secondary line.
        let detailKeys: [String]
        /// SF Symbol shown instead of `logo` for rows with no brand mark.
        var symbol: String? = nil

        var id: String { optionsKey }
    }

    struct Item: Identifiable, Equatable, Sendable {
        let provider: Provider
        let id: String
        let label: String
        let detail: String?
    }

    static let providers: [Provider] = [
        .init(optionsKey: "devices", selectionKey: "deviceIds", title: "Devices", logo: "", idKey: "deviceId", labelKeys: ["label"], detailKeys: ["platform"], symbol: "laptopcomputer"),
        .init(optionsKey: "awsRoles", selectionKey: "awsRoleIds", title: "AWS", logo: "logo-aws", idKey: "roleId", labelKeys: ["accountAlias", "accountId"], detailKeys: ["roleArn"]),
        .init(optionsKey: "gcpServiceAccounts", selectionKey: "gcpServiceAccountIds", title: "Google Cloud", logo: "logo-gcp", idKey: "serviceAccountId", labelKeys: ["projectId"], detailKeys: ["serviceAccountEmail"]),
        .init(optionsKey: "azureAccounts", selectionKey: "azureAccountIds", title: "Azure", logo: "logo-azure", idKey: "accountId", labelKeys: ["label"], detailKeys: ["subscriptionId"]),
        .init(optionsKey: "linodeAccounts", selectionKey: "linodeAccountIds", title: "Linode", logo: "logo-linode", idKey: "accountId", labelKeys: ["label"], detailKeys: []),
        .init(optionsKey: "hetznerAccounts", selectionKey: "hetznerAccountIds", title: "Hetzner", logo: "logo-hetzner", idKey: "accountId", labelKeys: ["label"], detailKeys: []),
        .init(optionsKey: "tencentAccounts", selectionKey: "tencentAccountIds", title: "Tencent Cloud", logo: "logo-tencent", idKey: "accountId", labelKeys: ["label"], detailKeys: ["roleArn"]),
        .init(optionsKey: "aliyunAccounts", selectionKey: "aliyunAccountIds", title: "Alibaba Cloud", logo: "logo-aliyun", idKey: "accountId", labelKeys: ["label"], detailKeys: ["roleArn"]),
        .init(optionsKey: "volcengineAccounts", selectionKey: "volcengineAccountIds", title: "Volcengine", logo: "logo-volcengine", idKey: "accountId", labelKeys: ["label"], detailKeys: ["roleTrn"]),
        .init(optionsKey: "zeaburProviders", selectionKey: "zeaburIds", title: "Zeabur", logo: "logo-zeabur", idKey: "zeaburId", labelKeys: ["name"], detailKeys: ["kind"]),
        .init(optionsKey: "onpremClusters", selectionKey: "onpremClusterIds", title: "Clusters", logo: "logo-kubernetes", idKey: "clusterId", labelKeys: ["label"], detailKeys: ["contextName"]),
        .init(optionsKey: "tailscaleClients", selectionKey: "tailscaleClientIds", title: "Tailscale", logo: "logo-tailscale", idKey: "clientId", labelKeys: ["label"], detailKeys: ["oauthClientId"]),
        .init(optionsKey: "betterStackIntegrations", selectionKey: "betterStackIntegrationIds", title: "Better Stack", logo: "logo-betterstack", idKey: "integrationId", labelKeys: ["label"], detailKeys: []),
        .init(optionsKey: "uptimeKumaInstances", selectionKey: "uptimeKumaInstanceIds", title: "Uptime Kuma", logo: "logo-uptime-kuma", idKey: "instanceId", labelKeys: ["label"], detailKeys: ["baseUrl"]),
        .init(optionsKey: "sentryAccounts", selectionKey: "sentryAccountIds", title: "Sentry", logo: "logo-sentry", idKey: "accountId", labelKeys: ["label"], detailKeys: ["userEmail"]),
        .init(optionsKey: "posthogIntegrations", selectionKey: "posthogIntegrationIds", title: "PostHog", logo: "logo-posthog", idKey: "integrationId", labelKeys: ["label"], detailKeys: ["apiBaseUrl"]),
        .init(optionsKey: "linearWorkspaces", selectionKey: "linearWorkspaceIds", title: "Linear", logo: "logo-linear", idKey: "workspaceId", labelKeys: ["label", "workspaceName"], detailKeys: ["workspaceName"]),
        .init(optionsKey: "jiraSites", selectionKey: "jiraSiteIds", title: "Jira", logo: "logo-jira", idKey: "siteId", labelKeys: ["label"], detailKeys: ["siteUrl"]),
        .init(optionsKey: "asanaAccounts", selectionKey: "asanaAccountIds", title: "Asana", logo: "logo-asana", idKey: "accountId", labelKeys: ["label"], detailKeys: ["accountEmail"]),
        .init(optionsKey: "vantaIntegrations", selectionKey: "vantaIntegrationIds", title: "Vanta", logo: "logo-vanta", idKey: "integrationId", labelKeys: ["label"], detailKeys: []),
        .init(optionsKey: "secureframeIntegrations", selectionKey: "secureframeIntegrationIds", title: "Secureframe", logo: "logo-secureframe", idKey: "integrationId", labelKeys: ["label"], detailKeys: ["region"]),
        .init(optionsKey: "resendIntegrations", selectionKey: "resendIntegrationIds", title: "Resend", logo: "logo-resend", idKey: "integrationId", labelKeys: ["label"], detailKeys: ["permission"]),
        .init(optionsKey: "githubInstallations", selectionKey: "githubInstallationIds", title: "GitHub", logo: "logo-github", idKey: "installationId", labelKeys: ["accountLogin"], detailKeys: ["accountType"]),
        .init(optionsKey: "gitlabBindings", selectionKey: "gitlabBindingIds", title: "GitLab", logo: "logo-gitlab", idKey: "bindingId", labelKeys: ["username"], detailKeys: ["hostUrl"]),
        .init(optionsKey: "grafanaInstances", selectionKey: "grafanaInstanceIds", title: "Grafana", logo: "logo-grafana", idKey: "instanceId", labelKeys: ["name"], detailKeys: ["grafanaUrl"]),
        .init(optionsKey: "sonarqubeIntegrations", selectionKey: "sonarqubeIntegrationIds", title: "SonarQube", logo: "logo-sonarqube", idKey: "integrationId", labelKeys: ["label"], detailKeys: ["baseUrl"]),
        .init(optionsKey: "notionIntegrations", selectionKey: "notionIntegrationIds", title: "Notion", logo: "logo-notion", idKey: "integrationId", labelKeys: ["label"], detailKeys: ["workspaceName"]),
        .init(optionsKey: "upstashAccounts", selectionKey: "upstashAccountIds", title: "Upstash", logo: "logo-upstash", idKey: "accountId", labelKeys: ["label"], detailKeys: ["email"]),
        .init(optionsKey: "cloudflareAccounts", selectionKey: "cloudflareAccountIds", title: "Cloudflare", logo: "logo-cloudflare", idKey: "accountId", labelKeys: ["accountName"], detailKeys: ["accountId"]),
    ]

    /// Providers that have at least one credential, in table order.
    let sections: [(provider: Provider, items: [Item])]

    var isEmpty: Bool { sections.isEmpty }
    var allItems: [Item] { sections.flatMap(\.items) }

    init(json: JSONValue) {
        sections = Self.providers.compactMap { provider in
            let rows = json[provider.optionsKey]?.arrayValue ?? []
            let items = rows.compactMap { row -> Item? in
                guard let id = row[provider.idKey]?.stringValue else { return nil }
                let label = provider.labelKeys.lazy.compactMap { row[$0]?.stringValue }.first(where: { !$0.isEmpty }) ?? id
                let detail = provider.detailKeys.lazy.compactMap { row[$0]?.stringValue }.first(where: { !$0.isEmpty && $0 != label })
                return Item(provider: provider, id: id, label: label, detail: provider.optionsKey == "devices" ? detail.map(Self.platformName) : detail)
            }
            return items.isEmpty ? nil : (provider, items)
        }
    }

    private init(sections: [(provider: Provider, items: [Item])]) {
        self.sections = sections
    }

    func scoped(to scope: CredentialScope) -> CredentialCatalog {
        CredentialCatalog(sections: sections.filter { scope.includes($0.provider.selectionKey) })
    }

    static func platformName(_ platform: String) -> String {
        switch platform {
        case "darwin": "macOS"
        case "win32": "Windows"
        case "linux": "Linux"
        default: platform
        }
    }

    static func == (a: CredentialCatalog, b: CredentialCatalog) -> Bool {
        a.sections.map(\.items) == b.sections.map(\.items)
    }
}

/// Which credentials a conversation may use, keyed by selection key.
struct CredentialSelection: Equatable, Codable, Sendable {
    var ids: [String: Set<String>] = [:]
    /// Stored keys this build has no row for, sent back untouched so a
    /// selection made on a newer client survives an edit here.
    var unknown: [String: JSONValue]?

    var isEmpty: Bool { ids.values.allSatisfy(\.isEmpty) }
    /// Nothing to send: no selection here and no keys only a newer client understands.
    var isBlank: Bool { isEmpty && (unknown ?? [:]).isEmpty }
    var count: Int { ids.values.reduce(0) { $0 + $1.count } }

    func count(in scope: CredentialScope) -> Int {
        let devices = ids["deviceIds"]?.count ?? 0
        return scope == .devices ? devices : count - devices
    }

    func contains(_ item: CredentialCatalog.Item) -> Bool {
        ids[item.provider.selectionKey]?.contains(item.id) ?? false
    }

    mutating func toggle(_ item: CredentialCatalog.Item) {
        var set = ids[item.provider.selectionKey] ?? []
        if set.contains(item.id) { set.remove(item.id) } else { set.insert(item.id) }
        ids[item.provider.selectionKey] = set
    }

    /// Clears only the requested scope (or everything when omitted).
    /// Send explicit empty arrays so the server revokes rather than preserves access.
    mutating func clearAll(scope: CredentialScope? = nil) {
        for provider in CredentialCatalog.providers where scope?.includes(provider.selectionKey) ?? true {
            ids[provider.selectionKey] = []
        }
        if scope != .devices {
            unknown = unknown?.mapValues { $0.arrayValue == nil ? $0 : .array([]) }
        }
    }

    mutating func selectAll(in catalog: CredentialCatalog) {
        for item in catalog.allItems where !contains(item) { toggle(item) }
    }

    func containsAll(in catalog: CredentialCatalog) -> Bool {
        !catalog.allItems.isEmpty && catalog.allItems.allSatisfy(contains)
    }

    /// `AgentCredentialSelection` — every known key present, empty arrays allowed.
    var json: JSONValue {
        var o = unknown ?? [:]
        for provider in CredentialCatalog.providers {
            o[provider.selectionKey] = .array((ids[provider.selectionKey] ?? []).sorted().map(JSONValue.string))
        }
        return .object(o)
    }

    private static let metadataKeys: Set<String> = ["updatedAt", "updatedBy"]

    /// From a stored `credentialAccess` object.
    init(json: JSONValue) {
        let known = Set(CredentialCatalog.providers.map(\.selectionKey))
        for (key, value) in json.objectValue ?? [:] {
            if known.contains(key) {
                let set = Set(value.arrayValue?.compactMap(\.stringValue) ?? [])
                if !set.isEmpty { ids[key] = set }
            } else if !Self.metadataKeys.contains(key) {
                unknown = (unknown ?? [:]).merging([key: value]) { _, new in new }
            }
        }
    }

    init() {}

    /// Drops ids the catalog no longer offers.
    func pruned(to catalog: CredentialCatalog) -> CredentialSelection {
        var copy = self
        let valid = Dictionary(grouping: catalog.allItems, by: { $0.provider.selectionKey }).mapValues { Set($0.map(\.id)) }
        for key in copy.ids.keys { copy.ids[key] = copy.ids[key]?.intersection(valid[key] ?? []) }
        return copy
    }
}

/// Auto Mode vs Bypass Permissions — what the first POST of a new
/// conversation sends as `permissionMode`.
enum PermissionMode: String, CaseIterable, Identifiable, Codable {
    case auto, bypass

    var id: String { rawValue }

    var title: String {
        switch self {
        case .auto: "Auto Mode"
        case .bypass: "Full Access"
        }
    }

    var subtitle: String {
        switch self {
        case .auto: "Risky commands ask for your approval"
        case .bypass: "Run every command without asking (default)"
        }
    }

    var systemImage: String {
        switch self {
        case .auto: "checkmark.shield"
        case .bypass: "shield.slash"
        }
    }
}
