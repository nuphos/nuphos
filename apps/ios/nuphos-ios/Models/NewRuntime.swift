import Foundation

/// The runtimes a computer can run itself, in the order its New runtime menu offers
/// them, and what choosing one does. Desktop's `LOCAL_AGENT_PROVIDERS` and
/// `newAgentAction` are the same list and the same rule; team runtimes can run more.
enum NewRuntime {
    static let providers: [RuntimeInstance.Provider] = [
        .claudeCode, .codex, .grok, .antigravity, .opencode, .dsh, .hermes, .pi,
    ]

    /// Still a preview, as Desktop marks them.
    static let previews: Set<RuntimeInstance.Provider> = [.dsh, .pi]

    /// What New runtime does for one provider.
    enum Action: Equatable {
        /// Add a runtime, then sign it in.
        case create
        /// Sign in the runtime of that provider this computer already has, by its runtime id.
        case signIn(String)
        /// Nothing to offer: Antigravity's sign-in is the computer's own, and shared.
        case unavailable
    }

    /// Sign in this computer's signed-out runtime of that provider first, so a lapsed
    /// sign-in never turns into a second runtime; else add one. An older host is the
    /// backend's to refuse: the runtimes a computer lists say nothing about what its host
    /// can do.
    static func action(_ runtimes: [RuntimeInstance], _ provider: RuntimeInstance.Provider) -> Action {
        if let idle = runtimes.first(where: { $0.provider == provider && $0.local?.signedIn != true }) {
            return .signIn(idle.id)
        }
        // Native keyring sign-in is shared; another home does not create another account.
        return provider == .antigravity ? .unavailable : .create
    }
}
