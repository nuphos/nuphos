import Foundation

/// The connector catalog: what `GET /teams/:id/connectors` returns, and how
/// each provider binds. One table drives the bound list, the Add catalog and
/// the connect flow — the same shape `CredentialCatalog` uses, so a new
/// provider is one row here and nothing else.
struct Connector: Identifiable, Hashable, Sendable {
    enum Category: String, CaseIterable, Sendable {
        case infrastructure, observability, networking, compliance
        case sourceControl, projectManagement, document, email

        /// Mirrors the desktop's `CONNECTOR_CATEGORIES` labels and order.
        var title: String {
            switch self {
            case .infrastructure: "Infrastructure"
            case .observability: "Observability"
            case .networking: "Networking"
            case .compliance: "Compliance"
            case .sourceControl: "Source control"
            case .projectManagement: "Project management"
            case .document: "Document"
            case .email: "Email"
            }
        }
    }

    struct Field: Identifiable, Hashable, Sendable {
        enum Kind: Hashable, Sendable { case text, secret, url, email }

        /// JSON key in the bind body. The backend schemas are `.strict()`, so
        /// a blank optional field is omitted rather than sent empty.
        let key: String
        let title: String
        var placeholder: String = ""
        var kind: Kind = .text
        var required: Bool = true

        var id: String { key }
    }

    /// What the Connect button does.
    enum Bind: Hashable, Sendable {
        /// `POST /teams/:id/<path>/start-oauth` → `{ authorizeUrl }`, finished
        /// in `ASWebAuthenticationSession` when the backend's callback page
        /// redirects to `nuphos://<callbackHost>`. The host is checked on the
        /// way back, so another provider's redirect can't satisfy this flow.
        case oauth(path: String, callbackHost: String)
        /// `GET /teams/:id/github-installations/install-url` → `{ url }`, then
        /// the same browser session, coming back on `nuphos://github-callback`.
        case githubApp
        /// `POST /teams/:id/<path>` with the filled fields as the body.
        case form(path: String, fields: [Field])
        /// Bound elsewhere for now (a console wizard the phone can't walk).
        /// Listed when present, never offered in the Add catalog.
        case desktopOnly
    }

    /// Key in the `GET /teams/:id/connectors` response.
    let key: String
    let title: String
    /// Asset-catalog mark, shared with `CredentialCatalog.Provider.logo`.
    let logo: String
    let category: Category
    let bind: Bind
    /// Shown under a credential form: a prerequisite the user has to have
    /// satisfied in the provider's console before the bind can succeed.
    var note: String? = nil
    /// Fields tried in order for a bound row's primary label.
    var labelKeys: [String] = ["label"]
    /// Fields tried in order for the secondary line.
    var detailKeys: [String] = []

    var id: String { key }

    /// True when the Add catalog can start this one from the phone.
    var isConnectable: Bool {
        if case .desktopOnly = bind { return false }
        return true
    }
}

extension Connector {
    static let all: [Connector] = [
        // MARK: Infrastructure
        .init(
            key: "aws", title: "AWS", logo: "logo-aws", category: .infrastructure,
            bind: .form(
                path: "aws-accounts",
                fields: [.init(key: "roleArn", title: "Role ARN", placeholder: "arn:aws:iam::123456789012:role/Nuphos")]
            ),
            note: "The role must already trust the Nuphos connector — Nuphos assumes it before saving the binding.",
            labelKeys: ["alias", "accountId"], detailKeys: ["roleArn"]
        ),
        .init(key: "gcp", title: "Google Cloud", logo: "logo-gcp", category: .infrastructure, bind: .desktopOnly,
              labelKeys: ["projectId"], detailKeys: ["serviceAccountEmail"]),
        .init(
            key: "azure", title: "Azure", logo: "logo-azure", category: .infrastructure,
            bind: .form(path: "azure-accounts", fields: [
                .init(key: "label", title: "Label", placeholder: "Production"),
                .init(key: "tenantId", title: "Tenant ID", placeholder: "00000000-0000-0000-0000-000000000000"),
                .init(key: "clientId", title: "Client ID", placeholder: "00000000-0000-0000-0000-000000000000"),
                .init(key: "subscriptionId", title: "Subscription ID", placeholder: "00000000-0000-0000-0000-000000000000"),
            ]),
            note: "The app registration needs a federated credential for this team before it can be bound.",
            detailKeys: ["subscriptionId"]
        ),
        .init(key: "cloudflare", title: "Cloudflare", logo: "logo-cloudflare", category: .infrastructure, bind: .desktopOnly,
              labelKeys: ["accountName", "label"], detailKeys: ["accountId"]),
        .init(
            key: "linode", title: "Linode", logo: "logo-linode", category: .infrastructure,
            bind: .form(path: "linode-accounts", fields: [
                .init(key: "label", title: "Label", placeholder: "Akamai"),
                .init(key: "token", title: "API token", kind: .secret),
            ])
        ),
        .init(
            key: "hetzner", title: "Hetzner Cloud", logo: "logo-hetzner", category: .infrastructure,
            bind: .form(path: "hetzner-accounts", fields: [
                .init(key: "label", title: "Label", placeholder: "Hetzner"),
                .init(key: "token", title: "API token", kind: .secret),
            ])
        ),
        .init(key: "tencent", title: "Tencent Cloud", logo: "logo-tencent", category: .infrastructure, bind: .desktopOnly,
              detailKeys: ["roleArn"]),
        .init(key: "aliyun", title: "Alibaba Cloud", logo: "logo-aliyun", category: .infrastructure, bind: .desktopOnly,
              detailKeys: ["roleArn"]),
        .init(key: "volcengine", title: "Volcengine", logo: "logo-volcengine", category: .infrastructure, bind: .desktopOnly,
              detailKeys: ["roleTrn"]),
        .init(
            key: "zeabur", title: "Zeabur", logo: "logo-zeabur", category: .infrastructure,
            bind: .form(path: "zeabur-providers", fields: [
                .init(key: "token", title: "API token", kind: .secret),
            ]),
            labelKeys: ["name"], detailKeys: ["kind"]
        ),
        .init(key: "onprem", title: "Clusters", logo: "logo-kubernetes", category: .infrastructure, bind: .desktopOnly,
              detailKeys: ["contextName"]),

        // MARK: Observability
        .init(
            key: "betterstack", title: "Better Stack", logo: "logo-betterstack", category: .observability,
            bind: .form(path: "betterstack-integrations", fields: [
                .init(key: "label", title: "Label", placeholder: "Better Stack"),
                .init(key: "uptimeApiToken", title: "Uptime API token", kind: .secret, required: false),
                .init(key: "telemetryApiToken", title: "Telemetry API token", kind: .secret, required: false),
            ]),
            note: "Provide at least one of the two tokens."
        ),
        .init(
            key: "uptimeKuma", title: "Uptime Kuma", logo: "logo-uptime-kuma", category: .observability,
            bind: .form(path: "uptime-kuma-instances", fields: [
                .init(key: "label", title: "Label", placeholder: "Uptime Kuma"),
                .init(key: "baseUrl", title: "Base URL", placeholder: "https://status.example.com", kind: .url),
                .init(key: "authToken", title: "Auth token", kind: .secret, required: false),
                .init(key: "username", title: "Username", required: false),
                .init(key: "password", title: "Password", kind: .secret, required: false),
            ]),
            note: "Provide either an auth token or a username and password.",
            detailKeys: ["baseUrl"]
        ),
        .init(
            key: "grafana", title: "Grafana", logo: "logo-grafana", category: .observability,
            bind: .form(path: "grafana-instances", fields: [
                .init(key: "name", title: "Name", placeholder: "Grafana"),
                .init(key: "grafanaUrl", title: "Grafana URL", placeholder: "https://grafana.example.com", kind: .url),
                .init(key: "saToken", title: "Service account token", kind: .secret),
            ]),
            labelKeys: ["name"], detailKeys: ["grafanaUrl"]
        ),
        .init(key: "sentry", title: "Sentry", logo: "logo-sentry", category: .observability,
              bind: .oauth(path: "sentry-accounts", callbackHost: "sentry-callback"), detailKeys: ["userEmail"]),

        // MARK: Networking
        .init(
            key: "tailscale", title: "Tailscale", logo: "logo-tailscale", category: .networking,
            bind: .form(path: "tailscale-clients", fields: [
                .init(key: "label", title: "Label", placeholder: "Tailnet"),
                .init(key: "clientId", title: "OAuth client ID"),
                .init(key: "clientSecret", title: "OAuth client secret", kind: .secret),
            ]),
            detailKeys: ["clientId"]
        ),

        // MARK: Compliance
        .init(
            key: "vanta", title: "Vanta", logo: "logo-vanta", category: .compliance,
            bind: .form(path: "vanta-integrations", fields: [
                .init(key: "label", title: "Label", placeholder: "Vanta"),
                .init(key: "clientId", title: "Client ID"),
                .init(key: "clientSecret", title: "Client secret", kind: .secret),
            ])
        ),
        .init(
            key: "secureframe", title: "Secureframe", logo: "logo-secureframe", category: .compliance,
            bind: .form(path: "secureframe-integrations", fields: [
                .init(key: "label", title: "Label", placeholder: "Secureframe"),
                .init(key: "apiKey", title: "API key", kind: .secret),
                .init(key: "apiSecret", title: "API secret", kind: .secret),
            ]),
            detailKeys: ["region"]
        ),
        .init(
            key: "sonarqube", title: "SonarQube", logo: "logo-sonarqube", category: .compliance,
            bind: .form(path: "sonarqube-integrations", fields: [
                .init(key: "label", title: "Label", placeholder: "SonarQube"),
                .init(key: "baseUrl", title: "Base URL", placeholder: "https://sonarcloud.io", kind: .url),
                .init(key: "token", title: "Token", kind: .secret),
            ]),
            detailKeys: ["baseUrl"]
        ),

        // MARK: Source control
        .init(key: "github", title: "GitHub", logo: "logo-github", category: .sourceControl,
              bind: .githubApp, labelKeys: ["accountLogin"], detailKeys: ["accountType"]),
        .init(key: "gitlab", title: "GitLab", logo: "logo-gitlab", category: .sourceControl, bind: .desktopOnly,
              labelKeys: ["username"], detailKeys: ["hostUrl"]),

        // MARK: Project management
        .init(key: "linear", title: "Linear", logo: "logo-linear", category: .projectManagement,
              bind: .oauth(path: "linear-workspaces", callbackHost: "linear-callback"), labelKeys: ["label", "workspaceName"], detailKeys: ["workspaceName"]),
        .init(key: "jira", title: "Jira", logo: "logo-jira", category: .projectManagement,
              bind: .oauth(path: "jira-sites", callbackHost: "jira-callback"), detailKeys: ["siteUrl"]),
        .init(key: "asana", title: "Asana", logo: "logo-asana", category: .projectManagement,
              bind: .oauth(path: "asana-accounts", callbackHost: "asana-callback"), detailKeys: ["accountEmail"]),
        .init(key: "plaud", title: "Plaud", logo: "logo-plaud", category: .document,
              bind: .oauth(path: "plaud-accounts", callbackHost: "plaud-callback"), detailKeys: ["userEmail"]),

        // MARK: Document
        .init(
            key: "notion", title: "Notion", logo: "logo-notion", category: .document,
            bind: .form(path: "notion-integrations", fields: [
                .init(key: "label", title: "Label", placeholder: "Notion"),
                .init(key: "token", title: "Integration token", kind: .secret),
            ]),
            detailKeys: ["workspaceName"]
        ),
        .init(
            key: "upstash", title: "Upstash", logo: "logo-upstash", category: .document,
            bind: .form(path: "upstash-accounts", fields: [
                .init(key: "label", title: "Label", placeholder: "Upstash"),
                .init(key: "email", title: "Account email", kind: .email),
                .init(key: "apiKey", title: "Management API key", kind: .secret),
            ]),
            detailKeys: ["email"]
        ),

        // MARK: Email
        .init(
            key: "resend", title: "Resend", logo: "logo-resend", category: .email,
            bind: .form(path: "resend-integrations", fields: [
                .init(key: "label", title: "Label", placeholder: "Resend"),
                .init(key: "apiKey", title: "API key", kind: .secret),
            ]),
            detailKeys: ["permission"]
        ),
    ]

    static func named(_ key: String) -> Connector? { all.first { $0.key == key } }
}

/// One bound instance of a connector, read out of the aggregated response.
struct ConnectorBinding: Identifiable, Equatable, Sendable {
    let connectorKey: String
    let id: String
    let label: String
    let detail: String?
}

/// `GET /teams/:id/connectors`, flattened to the rows the page renders.
struct ConnectorInventory: Equatable, Sendable {
    /// Bindings by connector key, in catalog order.
    let bindings: [String: [ConnectorBinding]]

    var isEmpty: Bool { bindings.values.allSatisfy(\.isEmpty) }

    func bindings(for connector: Connector) -> [ConnectorBinding] { bindings[connector.key] ?? [] }

    /// Categories that have at least one bound connector, in catalog order.
    var boundSections: [(category: Connector.Category, connectors: [Connector])] {
        Connector.Category.allCases.compactMap { category in
            let connectors = Connector.all.filter { $0.category == category && !bindings(for: $0).isEmpty }
            return connectors.isEmpty ? nil : (category, connectors)
        }
    }

    private static let idKeys = [
        "id", "roleId", "serviceAccountId", "accountId", "providerId", "installationId", "clusterId",
    ]

    init(json: JSONValue) {
        var out: [String: [ConnectorBinding]] = [:]
        for connector in Connector.all {
            // Providers whose slot is an object (slack, lark) are not in the
            // catalog; `arrayValue` is nil for those and the key is skipped.
            let rows = json[connector.key]?.arrayValue ?? []
            out[connector.key] = rows.compactMap { row -> ConnectorBinding? in
                // Binding ids are not uniformly named across the per-provider
                // views; `id` first matters for the two (github, cloudflare)
                // that carry both `id` and a provider-side `accountId`.
                guard let id = Self.idKeys.lazy.compactMap({ row[$0]?.stringValue }).first(where: { !$0.isEmpty })
                else { return nil }
                let label = connector.labelKeys.lazy.compactMap { row[$0]?.stringValue }.first { !$0.isEmpty }
                let detail = connector.detailKeys.lazy.compactMap { row[$0]?.stringValue }.first { !$0.isEmpty && $0 != label }
                return ConnectorBinding(connectorKey: connector.key, id: id, label: label ?? connector.title, detail: detail)
            }
        }
        bindings = out
    }
}
