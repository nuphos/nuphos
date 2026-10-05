import Foundation

/// One agent a team can start conversations on
/// (`GET /teams/:id/agent-runtimes`): a Cloud runtime, or one of the
/// signed-in user's own computers (`kind == "local"`).
struct RuntimeInstance: Codable, Identifiable, Equatable, Hashable, Sendable {
    enum Provider: String, Codable, Sendable { case claudeCode = "claude-code", codex, grok, antigravity }
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
    let defaults: Defaults?

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
        default: "logo-claude"
        }
    }

    static func name(_ raw: String?) -> String {
        switch raw {
        case "codex": "Codex"
        case "claude-code": "Claude Code"
        case "grok": "Grok Build"
        case "antigravity": "Antigravity"
        case "nuphos": "Nuphos"
        default: raw?.capitalized ?? "Runtime"
        }
    }
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

    var model: Option? { options.first { $0.kind == .model } }
    var isFast: Bool { options.contains { $0.kind == .fast && $0.currentValue == "on" } }

    /// Writes restore a dormant session, so its remembered settings stay editable.
    var isEditable: Bool { status == .ready || (status == .dormant && !options.isEmpty) }

    /// Show the model whenever one is known; "unavailable" means the agent is offline.
    var modelTitle: String {
        if let model { return model.currentLabel }
        return status == .offline ? "Model unavailable" : "Model"
    }

    var hint: String? {
        switch status {
        case .busy: "You can change model settings after this reply."
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

        var sessionId: String? {
            guard let key, key.hasPrefix(Self.sessionPrefix) else { return nil }
            let id = String(key.dropFirst(Self.sessionPrefix.count))
            return id.isEmpty ? nil : id
        }

        static func chat(sessionId: String, label: String) -> Entry {
            Entry(label: String(label.prefix(200)), key: sessionPrefix + sessionId, href: nil)
        }
    }

    var entries: [Entry]
    var revision: Int

    var pinnedSessionIds: Set<String> { Set(entries.compactMap(\.sessionId)) }
}
