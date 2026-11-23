import Foundation

/// Adding a runtime to a computer follows Desktop's rules, not a second set:
/// who may add (`canAddAgent`), which providers in which order
/// (`LOCAL_AGENT_PROVIDERS`), what a provider does (`newAgentAction`) and the name a
/// new runtime starts with (`defaultAgentName`).
enum NewRuntimeTests {
    static func run() {
        offersTheSameProvidersInTheSameOrder()
        listsANewBoxsRuntimesInAFixedOrder()
        onlyManagersOfARunningComputerMayAdd()
        signsInASignedOutRuntimeInsteadOfAddingASecond()
        namesANewRuntimePastTheOnesAlreadyThere()
        aBoxThatBringsItsRuntimeIsStarting()
        print("New runtime passed")
    }

    private static func offersTheSameProvidersInTheSameOrder() {
        precondition(NewRuntime.providers.map(\.rawValue) == [
            "claude-code", "codex", "grok", "antigravity", "opencode", "dsh", "hermes", "pi",
        ], "The New runtime menu must offer Desktop's LOCAL_AGENT_PROVIDERS in Desktop's order")
        // Every one of them has a name and a mark, so no menu item reads "Unknown runtime".
        for provider in NewRuntime.providers {
            let name = RuntimeInstance.Provider.name(provider.rawValue)
            precondition(name != "Unknown runtime" && name != "Runtime", "\(provider.rawValue) has no name")
            precondition(RuntimeInstance.Provider.logo(provider.rawValue) != nil, "\(provider.rawValue) has no mark")
        }
        precondition(NewRuntime.previews == [.dsh, .pi])
    }

    private static func onlyManagersOfARunningComputerMayAdd() {
        // A computer of one's own: its host being connected is the whole of "running".
        precondition(device(access: "owner", online: true).canAddRuntime)
        precondition(device(access: "manage", online: true).canAddRuntime)
        precondition(!device(access: "use", online: true).canAddRuntime, "Use access must not add runtimes")
        precondition(!device(access: "owner", online: false).canAddRuntime, "An offline computer takes no runtime")
        // An older backend names no access level; Desktop reads that as manageable.
        precondition(device(access: nil, online: true).canAddRuntime)
        precondition(!device(access: nil, online: nil).canAddRuntime)
        // A Box: running and connected, and nothing else.
        precondition(device(access: "owner", online: true, box: "running").canAddRuntime)
        for state in ["creating", "connecting", "paused", "stopped", "error"] {
            precondition(!device(access: "owner", online: true, box: state).canAddRuntime, "A \(state) Box takes no runtime")
        }
        // Desktop's hostOffline: a running Box whose host is away.
        precondition(!device(access: "owner", online: false, box: "running").canAddRuntime)
    }

    private static func signsInASignedOutRuntimeInsteadOfAddingASecond() {
        precondition(NewRuntime.action([], .opencode) == .create)
        precondition(NewRuntime.action([signedIn(.claudeCode, "a")], .opencode) == .create)
        // A lapsed sign-in must never turn into a second runtime.
        precondition(NewRuntime.action([signedOut(.codex, "b")], .codex) == .signIn("b"))
        precondition(NewRuntime.action([signedIn(.codex, "c")], .codex) == .create)
        // A computer whose report cannot tell is not signed in either.
        precondition(NewRuntime.action([unknown(.grok, "d")], .grok) == .signIn("d"))
        // Antigravity's sign-in is the computer's own and shared, so there is no second one.
        precondition(NewRuntime.action([], .antigravity) == .unavailable)
        precondition(NewRuntime.action([signedIn(.antigravity, "e")], .antigravity) == .unavailable)
        precondition(NewRuntime.action([signedOut(.antigravity, "f")], .antigravity) == .signIn("f"))
    }

    private static func namesANewRuntimePastTheOnesAlreadyThere() {
        precondition(box([]).defaultRuntimeName(.opencode) == "OpenCode")
        precondition(box([named(.opencode, "g", "OpenCode")]).defaultRuntimeName(.opencode) == "OpenCode 2")
        precondition(box([named(.opencode, "g", "OpenCode"), named(.opencode, "h", "OpenCode 2")])
            .defaultRuntimeName(.opencode) == "OpenCode 3")
        // A runtime goes by its provider's name while it has none of its own.
        precondition(box([signedIn(.opencode, "i")]).defaultRuntimeName(.opencode) == "OpenCode 2")
        // Another provider's runtime never pushes the number along.
        precondition(box([signedIn(.codex, "j")]).defaultRuntimeName(.opencode) == "OpenCode")
        let taken = box([named(.opencode, "k", "Spare")])
        precondition(taken.nameTaken("spare") && taken.nameTaken("  Spare  ") && !taken.nameTaken("Spare 2"))
    }

    /// Home says a Box that brings its runtime by itself is getting ready, rather than asking for a
    /// computer. Online or not does not matter: a Box goes online before its runtime is listed (#4839).
    private static func aBoxThatBringsItsRuntimeIsStarting() {
        for state in ["creating", "connecting", "running"] {
            for online in [true, false, nil] as [Bool?] {
                precondition(device(access: "owner", online: online, box: state).isStarting, "A \(state) Box is starting")
            }
        }
        for state in ["paused", "error"] {
            precondition(!device(access: "owner", online: false, box: state).isStarting, "A \(state) Box is not starting")
        }
        precondition(!device(access: "owner", online: true).isStarting, "A computer is never starting")
    }

    // MARK: - Fixtures

    private static func device(access: String?, online: Bool?, box state: String? = nil) -> AgentDevice {
        let boxJSON = state.map { #","box":{"state":"\#($0)"}"# } ?? ""
        let accessJSON = access.map { #""access":"\#($0)","# } ?? ""
        let onlineJSON = online.map { #""online":\#($0 ? "true" : "false"),"# } ?? ""
        return try! JSONDecoder().decode(AgentDevice.self, from: Data(
            #"{"deviceId":"mac","label":"Mac mini",\#(accessJSON)\#(onlineJSON)"metricsStatus":"offline","metrics":null\#(boxJSON)}"#.utf8))
    }

    private static func listsANewBoxsRuntimesInAFixedOrder() {
        let first = [signedOut(.grok, "g"), signedOut(.pi, "p")]
        let later = first + [signedOut(.opencode, "o"), signedOut(.claudeCode, "c")]
        precondition(NewRuntime.ordered(first).map(\.id) == ["g", "p"])
        precondition(NewRuntime.ordered(later).map(\.id) == ["c", "g", "o", "p"],
                     "Runtimes take Desktop's LOCAL_AGENT_PROVIDERS slots, whatever order they join in")
        precondition(NewRuntime.ordered(later.reversed()).map(\.id) == ["c", "g", "o", "p"])
    }

    private static func box(_ agents: [RuntimeInstance]) -> SelectorBox {
        .init(id: "device:mac", label: "Mac mini", device: device(access: "owner", online: true), agents: agents)
    }

    private static func runtime(_ provider: RuntimeInstance.Provider, _ id: String, signedIn: String, label: String? = nil) -> RuntimeInstance {
        let agentLabel = label.map { #""agentLabel":"\#($0)","# } ?? ""
        return try! JSONDecoder().decode(RuntimeInstance.self, from: Data(
            #"{"id":"\#(id)","provider":"\#(provider.rawValue)","label":"on Mac mini","status":"active","kind":"local","local":{"ownerUserId":"u1","deviceId":"mac","deviceLabel":"Mac mini",\#(agentLabel)"signedIn":\#(signedIn)}}"#.utf8))
    }

    private static func signedIn(_ provider: RuntimeInstance.Provider, _ id: String) -> RuntimeInstance {
        runtime(provider, id, signedIn: "true")
    }

    private static func signedOut(_ provider: RuntimeInstance.Provider, _ id: String) -> RuntimeInstance {
        runtime(provider, id, signedIn: "false")
    }

    private static func unknown(_ provider: RuntimeInstance.Provider, _ id: String) -> RuntimeInstance {
        runtime(provider, id, signedIn: "null")
    }

    private static func named(_ provider: RuntimeInstance.Provider, _ id: String, _ label: String) -> RuntimeInstance {
        runtime(provider, id, signedIn: "true", label: label)
    }
}
