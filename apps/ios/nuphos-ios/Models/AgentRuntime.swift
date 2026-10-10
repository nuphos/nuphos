import Foundation

/// One agent a team can start conversations on
/// (`GET /teams/:id/agent-runtimes`): a Cloud runtime, or one of the
/// signed-in user's own computers (`kind == "local"`).
struct RuntimeInstance: Codable, Identifiable, Equatable, Hashable, Sendable {
    enum Provider: String, Codable, Sendable { case claudeCode = "claude-code", codex, grok, antigravity, opencode }
    enum Status: String, Codable, Sendable { case active, disabled }

    struct Defaults: Codable, Equatable, Hashable, Sendable {
        let model: String?
        let fast: String?
        let effort: String?
    }

    struct Local: Codable, Equatable, Hashable, Sendable {
        let ownerUserId: String
        let deviceId: String
        let deviceLabel: String
        /// The owner's own CLI sign-in; nil when their computer cannot tell.
        let signedIn: Bool?
    }

    enum Tier: CaseIterable, Hashable {
        case myComputers, cloud

        var title: String {
            switch self {
            case .myComputers: "My computers"
            case .cloud: "Cloud"
            }
        }
    }

    let id: String
    let provider: Provider
    let label: String
    let status: Status
    let kind: String?
    let local: Local?
    var defaults: Defaults?

    /// iOS never runs an agent itself, so every local agent is on another computer.
    var tier: Tier { kind == "local" || local != nil ? .myComputers : .cloud }

    var isSelectable: Bool { status == .active && local?.signedIn != false }

    var providerName: String { Provider.name(provider.rawValue) }

    /// A computer's agent is named for the computer; its provider goes in `subtitle`.
    var name: String {
        guard tier == .myComputers else { return label }
        if let deviceLabel = local?.deviceLabel, !deviceLabel.isEmpty { return deviceLabel }
        let suffix = " · \(providerName)"
        return label.hasSuffix(suffix) ? String(label.dropLast(suffix.count)) : label
    }

    var subtitle: String? {
        let hint: String? =
            if local?.signedIn == false { "Signed out · sign in to \(providerName) on that computer" }
            else if status == .disabled { tier == .myComputers ? "Offline · open Nuphos on that computer" : "Disabled" }
            else { nil }
        guard tier == .myComputers else { return hint }
        return [providerName, hint].compactMap(\.self).joined(separator: " · ")
    }

    /// Picker sections in display order; empty ones are left out.
    static func grouped(_ runtimes: [RuntimeInstance]) -> [(tier: Tier, runtimes: [RuntimeInstance])] {
        Tier.allCases.compactMap { tier in
            let members = runtimes.filter { $0.tier == tier }
            return members.isEmpty ? nil : (tier, members)
        }
    }

    /// With no saved choice, a new conversation starts on a usable Cloud agent.
    static func defaultPick(_ runtimes: [RuntimeInstance]) -> RuntimeInstance? {
        runtimes.first { $0.tier == .cloud && $0.isSelectable } ?? runtimes.first(where: \.isSelectable)
    }
}

extension RuntimeInstance.Provider {
    /// Asset catalog mark: Claude's for Claude Code, OpenAI's for Codex.
    static func logo(_ raw: String?) -> String {
        switch raw {
        case "codex": "logo-openai"
        case "grok": "logo-grok"
        case "antigravity": "logo-antigravity"
        case "opencode": "logo-opencode"
        default: "logo-claude"
        }
    }

    static func name(_ raw: String?) -> String {
        switch raw {
        case "codex": "Codex"
        case "claude-code": "Claude Code"
        case "grok": "Grok Build"
        case "antigravity": "Antigravity"
        case "opencode": "OpenCode"
        case "nuphos": "Nuphos"
        default: raw?.capitalized ?? "Runtime"
        }
    }
}

/// Provider usage for one agent (`GET /teams/:id/agent-runtimes/quota`).
struct RuntimeQuota: Decodable, Sendable {
    struct Window: Decodable, Sendable {
        let label: String
        let usedPercent: Double
        let resetsAt: Date?
    }

    let runtimeId: String
    let available: Bool
    /// Why there are no figures, in the agent's own words.
    let reason: String?
    let windows: [Window]

    var needsSignIn: Bool { !available && reason == "Sign in required" }

    /// The window closest to running out decides what the row says.
    var tightest: Window? { available ? windows.max { $0.usedPercent < $1.usedPercent } : nil }
}

/// Model / effort / fast controls the runtime exposes for one conversation
/// (`GET|PATCH /agent/conversations/:id/model-config`).
struct SessionConfigState: Codable, Equatable, Sendable {
    enum Status: String, Codable, Sendable { case ready, busy, dormant, unsupported, offline }

    struct Option: Codable, Equatable, Identifiable, Sendable {
        enum Kind: String, Codable, Sendable { case model, effort, fast }
        struct Choice: Codable, Equatable, Identifiable, Sendable {
            let value: String
            let name: String
            let description: String?
            var id: String { value }
        }

        let id: String
        let name: String
        let kind: Kind
        let description: String?
        let currentValue: String
        let options: [Choice]

        var currentLabel: String {
            let choice = options.first { $0.value == currentValue }
            if kind == .model && (currentValue.lowercased() == "default" || ["default", "default model", "agent default", "runtime default"].contains(choice?.name.lowercased() ?? "")) {
                return options.first { candidate in
                    candidate.value.lowercased() != "default" && candidate.name.lowercased() != "default" &&
                    choice?.description?.localizedCaseInsensitiveContains(candidate.name) == true
                }?.name ?? "Model"
            }
            return choice?.name ?? currentValue
        }
    }

    let status: Status
    let options: [Option]

    func retainingOptions(from previous: SessionConfigState?) -> SessionConfigState {
        options.isEmpty && ![.ready, .unsupported].contains(status)
            ? .init(status: status, options: previous?.options ?? []) : self
    }

    /// Latest selection per control; apply model first, then only still-valid controls.
    func nextSelection(in pending: inout [String: String], streaming: Bool) -> (id: String, value: String)? {
        guard !streaming, [.ready, .dormant].contains(status) else { return nil }
        let ids = [model?.id].compactMap { $0 } + pending.keys.sorted().filter { $0 != model?.id }
        for id in ids {
            guard let value = pending.removeValue(forKey: id) else { continue }
            if options.contains(where: { $0.id == id && $0.options.contains(where: { $0.value == value }) }) {
                return (id, value)
            }
        }
        return nil
    }

    var model: Option? { options.first { $0.kind == .model } }
    var isFast: Bool { options.contains { $0.kind == .fast && $0.currentValue == "on" } }

    /// Writes restore a dormant session, so its remembered settings stay editable.
    var isEditable: Bool { [.ready, .busy, .dormant].contains(status) && !options.isEmpty }

    /// Show the model whenever one is known; "unavailable" means the agent is offline.
    var modelTitle: String {
        if let model, !model.currentValue.isEmpty { return model.currentLabel }
        return status == .offline ? "Model unavailable" : "Model"
    }

    var hint: String? {
        switch status {
        case .busy: "Changes apply after this reply."
        case .dormant: options.isEmpty ? "Send a message to start this session before changing model settings." : nil
        case .offline: "This agent is offline. Model settings return when it reconnects."
        case .ready, .unsupported: nil
        }
    }
}

/// `GET /teams/:id/favorites` — the desktop sidebar's pinned entries. Chats
/// are pinned under the key `agent-session:<sessionId>`.
struct SidebarFavorites: Codable, Equatable, Sendable {
    struct Entry: Codable, Equatable, Sendable {
        var label: String
        var key: String?
        var href: String?

        static let sessionPrefix = "agent-session:"

        /// The pinned chat, whichever identity it was pinned under: an
        /// `agent-session:` key, or the `/teams/<team>/agent/<session>` href
        /// Desktop pins a chat row by.
        var sessionId: String? {
            if let key, key.hasPrefix(Self.sessionPrefix) {
                let id = String(key.dropFirst(Self.sessionPrefix.count))
                return id.isEmpty ? nil : id
            }
            guard let href, let path = URLComponents(string: href)?.percentEncodedPath else { return nil }
            let parts = path.split(separator: "/", omittingEmptySubsequences: false)
            guard parts.count == 5, parts[0].isEmpty, parts[1] == "teams", !parts[2].isEmpty, parts[3] == "agent",
                  let id = parts[4].removingPercentEncoding, !id.isEmpty else { return nil }
            return id
        }

        static func chat(sessionId: String, label: String) -> Entry {
            Entry(label: String(label.prefix(200)), key: sessionPrefix + sessionId, href: nil)
        }
    }

    var entries: [Entry]
    var revision: Int

    var pinnedSessionIds: Set<String> { Set(entries.compactMap(\.sessionId)) }
}


/// Discovery before a conversation exists, shared with Desktop.
struct RuntimeModelCatalog: Decodable {
    struct Model: Decodable {
        let id: String
        let name: String
        let description: String?
    }
    struct Controls: Decodable {
        struct Effort: Decodable { let value: String; let name: String }
        let modelId: String
        let effort: [Effort]
        let fast: Bool
        let defaultFast: String?
        let defaultEffort: String?
    }
    let models: [Model]
    let controls: Controls?
    let message: String?

    func config(defaults: RuntimeInstance.Defaults?) -> SessionConfigState {
        let concrete = models.filter {
            $0.id.lowercased() != "default" &&
            !["default", "default model", "agent default", "runtime default"].contains($0.name.lowercased())
        }
        let requested = defaults?.model ?? controls?.modelId
        let alias = models.first { $0.id == requested }
        let current: String
        if let requested, requested.lowercased() != "default",
           !["default", "default model", "agent default", "runtime default"].contains(alias?.name.lowercased() ?? "") {
            current = requested
        } else {
            current = concrete.first {
                alias?.description?.localizedCaseInsensitiveContains($0.name) == true ||
                alias?.description?.lowercased() == $0.id.lowercased()
            }?.id ?? ""
        }
        var options: [SessionConfigState.Option] = [
            .init(id: "model", name: "Model", kind: .model, description: nil, currentValue: current,
                  options: concrete.map { .init(value: $0.id, name: $0.name, description: nil) })
        ]
        let efforts = controls?.effort.filter { $0.value != "default" } ?? []
        if !efforts.isEmpty {
            let inherited = defaults?.effort ?? controls?.defaultEffort
            let effort = efforts.first { $0.value == inherited }?.value ?? ""
            options.append(.init(id: "effort", name: "Effort", kind: .effort, description: nil,
                                 currentValue: effort, options: efforts.map { .init(value: $0.value, name: $0.name, description: nil) }))
        }
        if controls?.fast == true {
            options.append(.init(id: "fast", name: "Fast mode", kind: .fast, description: nil,
                                 currentValue: defaults?.fast ?? controls?.defaultFast ?? "",
                                 options: [.init(value: "on", name: "On", description: nil), .init(value: "off", name: "Off", description: nil)]))
        }
        return .init(status: .ready, options: options)
    }
}
