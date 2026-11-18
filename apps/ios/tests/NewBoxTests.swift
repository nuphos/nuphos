import Foundation

/// The Box rules `NewBoxView`, `RuntimesPage` and `AgentStore` follow (#3624).
@main
struct NewBoxTests {
    static func main() throws {
        offersABoxToAnAdministratorWhereBoxesAreMade()
        sendsDesktopsRequest()
        showsThePlansRefusalInTheServersWords()
        keepsANewBoxStartingUntilItsRuntimesJoin()
        labelsABoxsStateAndWhoMayResumeIt()
        print("New Box passed")
    }

    private static func offersABoxToAnAdministratorWhereBoxesAreMade() {
        precondition(NewBox.offered(boxAvailable: true, canCreateBox: true))
        precondition(!NewBox.offered(boxAvailable: true, canCreateBox: false), "a member is not offered a Box")
        precondition(!NewBox.offered(boxAvailable: false, canCreateBox: true), "a deployment without Boxes offers none")
        precondition(!NewBox.offered(boxAvailable: nil, canCreateBox: nil), "an older backend offers none")
    }

    private static func sendsDesktopsRequest() {
        precondition(NewBox.path == "agent/devices/boxes")
        precondition(NewBox.resumePath(deviceId: "box-1") == "agent/devices/box-1/box/resume")
        precondition(NewBox.defaultName(after: []) == "Computer 1")
        precondition(NewBox.defaultName(after: ["Computer 2", "Computer 10", "Mac", "My Computer 40"]) == "Computer 11")

        let named = try! JSONSerialization.jsonObject(with: JSONEncoder().encode(
            NewBox.request(typed: "  Build box \n", labels: [], teamId: "team-1"))) as! [String: String]
        precondition(named == ["label": "Build box", "teamId": "team-1"], "only the name and team are sent; the backend picks the size")

        let unnamed = NewBox.request(typed: "   ", labels: ["Computer 1"], teamId: "team-1")
        precondition(unnamed.label == "Computer 2", "the default shown is the name sent")
    }

    private static func showsThePlansRefusalInTheServersWords() {
        let sentence = "Your plan allows 0 vCPU of running computers."
        let refused = NewBox.Failure(code: "box_vcpu_limit", message: sentence)
        precondition(refused.plan && refused.message == sentence)
        let other = NewBox.Failure(code: "box_unavailable", message: "Try again later.")
        precondition(!other.plan && other.message == "Try again later.")
        precondition(!NewBox.Failure(code: nil, message: "offline").plan)
    }

    private static func keepsANewBoxStartingUntilItsRuntimesJoin() {
        let made = Date(timeIntervalSince1970: 1_000)
        precondition(NewBox.phase(madeAt: nil, now: made, state: nil, runtimes: 0) == .idle)
        // Not listed yet, or the list read failed and kept the old one: still starting.
        precondition(NewBox.phase(madeAt: made, now: made + 20, state: nil, runtimes: 0) == .starting)
        precondition(NewBox.phase(madeAt: made, now: made + 20, state: "connecting", runtimes: 0) == .starting)
        precondition(NewBox.phase(madeAt: made, now: made + 20, state: "running", runtimes: 5) == .ready)
        precondition(NewBox.phase(madeAt: made, now: made + 20, state: "error", runtimes: 0) == .error)
        // Desktop's five-minute timeout.
        precondition(NewBox.phase(madeAt: made, now: made + 300, state: "creating", runtimes: 0) == .starting)
        precondition(NewBox.phase(madeAt: made, now: made + 301, state: "creating", runtimes: 0) == .timeout)
        precondition(NewBox.phase(madeAt: made, now: made + 301, state: nil, runtimes: 1) == .ready)
    }

    private static func labelsABoxsStateAndWhoMayResumeIt() {
        precondition(NewBox.stateLabel("creating") == "Starting")
        precondition(NewBox.stateLabel("connecting") == "Connecting")
        precondition(NewBox.stateLabel("paused") == "Paused")
        precondition(NewBox.stateLabel("error") == "Didn't start")
        precondition(NewBox.stateLabel("running") == nil, "a running Box shows no state")

        precondition(NewBox.resumable(state: "paused", access: "owner"))
        precondition(NewBox.resumable(state: "paused", access: "manage"))
        precondition(NewBox.resumable(state: "paused", access: nil))
        precondition(!NewBox.resumable(state: "paused", access: "use"), "a teammate who may only use it cannot resume it")
        precondition(!NewBox.resumable(state: "running", access: "owner"))
        precondition(!NewBox.resumable(state: "creating", access: "owner"))
    }
}
