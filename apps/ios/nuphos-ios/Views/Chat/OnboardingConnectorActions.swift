#if os(iOS)
import SwiftUI

/// An explicit onboarding action. The same team OAuth flow as Connectors runs
/// first, then the selected credential is added to the Bot's own session.
struct OnboardingConnectorActions: View {
    @Environment(AgentStore.self) private var store
    @Environment(ConnectorsStore.self) private var connectors
    @Environment(\.locale) private var locale
    let target: PushTarget
    let channel: ChannelSession

    @State private var active: Connector?
    @State private var choices: [CredentialCatalog.Item] = []
    @State private var choosing = false
    @State private var choosingConnector: Connector?
    @State private var connected: Set<String> = []
    @State private var tried: Set<String> = []
    @State private var failure: String?

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(target.onboardingConnectorKeys.compactMap(Connector.named)) { connector in
                    if connected.contains(connector.key) {
                        if !tried.contains(connector.key) {
                            Button { tryConnector(connector) } label: {
                                Text("Try \(connector.title)")
                            }
                        }
                    } else {
                        Button { Task { await connect(connector) } } label: {
                            if active == connector {
                                ProgressView()
                            } else {
                                Text("Connect \(connector.title)")
                            }
                        }
                        .disabled(active != nil || choosing)
                    }
                }
            }
            .buttonStyle(.bordered)
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
        }
        .scrollIndicators(.hidden)
        .background(Theme.chatCanvas)
        .confirmationDialog("Choose credentials", isPresented: $choosing, titleVisibility: .visible) {
            ForEach(choices) { item in
                Button(item.label) {
                    guard let connector = choosingConnector, active == nil else { return }
                    active = connector
                    Task { await grant(item, for: connector) }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Couldn't connect", isPresented: Binding(
            get: { failure != nil }, set: { if !$0 { failure = nil } }
        )) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
    }

    private func available(for connector: Connector) async -> [CredentialCatalog.Item] {
        await store.loadCredentialOptions(force: true)
        return store.credentialCatalog?.answering([connector.key]).allItems.filter {
            $0.selectable && $0.provider.selectionKey == CredentialCatalog.connectKeys[connector.key]
        } ?? []
    }

    private func connect(_ connector: Connector) async {
        guard active == nil else { return }
        active = connector
        var items = await available(for: connector)
        if items.isEmpty {
            if let error = store.credentialCatalogError {
                failure = error
                active = nil
                return
            }
            guard await connectors.connect(connector, teamId: target.teamId) else {
                failure = connectors.connectError
                connectors.connectError = nil
                active = nil
                return
            }
            items = await available(for: connector)
        }
        switch items.count {
        case 0:
            failure = store.credentialCatalogError ?? String(localized: "Couldn't load your credentials. Try again.")
            active = nil
        case 1:
            await grant(items[0], for: connector)
        default:
            choices = items
            choosingConnector = connector
            active = nil
            choosing = true
        }
    }

    private func grant(_ item: CredentialCatalog.Item, for connector: Connector) async {
        defer { active = nil }
        guard let botId = target.onboardingBotId else { return }
        do {
            let detail = try await NuphosAPI.conversationDetail(token: store.token, teamId: target.teamId, sessionId: botId, tail: 1)
            var selection = CredentialSelection(json: detail.credentialAccess ?? .object([:]))
            if !selection.contains(item) {
                selection.toggle(item)
                try await AgentChatAPI.updateCredentials(token: store.token, teamId: target.teamId, sessionId: botId, selection: selection)
            }
            connected.insert(connector.key)
        } catch {
            failure = error.localizedDescription
        }
    }

    private func tryConnector(_ connector: Connector) {
        let language = Locale(identifier: "en").localizedString(forIdentifier: locale.identifier) ?? locale.identifier
        let prompt: String
        if connector.key == "linear" {
            prompt = locale.identifier == "zh-Hant"
                ? "Linear 已連接。請列出我手上最多三筆待辦事項，用繁體中文摘要。"
                : "Linear is connected. Please list up to three of my open issues and reply in \(language)."
        } else {
            prompt = locale.identifier == "zh-Hant"
                ? "\(connector.title) 已連接。請示範一個唯讀的小任務，用繁體中文說明結果。"
                : "\(connector.title) is connected. Please show me one small read-only task I can try and reply in \(language)."
        }
        tried.insert(connector.key)
        channel.send(ComposerSubmission(text: prompt, attachments: []))
    }
}
#endif
