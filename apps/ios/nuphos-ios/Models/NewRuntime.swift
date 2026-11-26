import Foundation

/// The runtimes a computer can run itself, in the order its New runtime menu offers
/// them, and what choosing one does. Desktop's `LOCAL_AGENT_PROVIDERS` and
/// `newAgentAction` are the same list and the same rule; team runtimes can run more.
enum NewRuntime {
    static let providers: [RuntimeInstance.Provider] = [
        .claudeCode, .codex, .grok, .antigravity, .opencode, .dsh, .hermes, .pi, .cursor,
    ]

    /// The runtimes a new Box lists, in this same order, so one that joins later
    /// never moves the rows already shown. Ties keep a fixed order by id.
    static func ordered(_ runtimes: [RuntimeInstance]) -> [RuntimeInstance] {
        let rank = { (runtime: RuntimeInstance) in providers.firstIndex(of: runtime.provider) ?? providers.count }
        return runtimes.sorted { (rank($0), $0.id) < (rank($1), $1.id) }
    }

    /// Still a preview, as Desktop marks them.
    static let previews: Set<RuntimeInstance.Provider> = [.dsh, .pi, .cursor]

    /// What New runtime does for one provider.
    enum Action: Equatable {
        /// Add a runtime, then sign it in.
        case create
        /// Sign in the runtime of that provider this computer already has, by its runtime id.
        case signIn(String)
    }

    /// Sign in this computer's signed-out runtime of that provider first, so a lapsed
    /// sign-in never turns into a second runtime; else add one. An older host is the
    /// backend's to refuse: the runtimes a computer lists say nothing about what its host
    /// can do. Nothing for Antigravity otherwise, so the list leaves it out.
    static func action(_ runtimes: [RuntimeInstance], _ provider: RuntimeInstance.Provider) -> Action? {
        if let idle = runtimes.first(where: { $0.provider == provider && $0.local?.signedIn != true }) {
            return .signIn(idle.id)
        }
        // Native keyring sign-in is shared; another home does not create another account.
        return provider == .antigravity ? nil : .create
    }
}
