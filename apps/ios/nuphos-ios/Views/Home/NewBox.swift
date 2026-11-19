import Foundation

/// The rules for making a Box and showing one, as Desktop has them. Foundation only, so
/// `tests/run.sh` checks them without the app.
enum NewBox {
    /// Desktop's Add computer offers a Box on the same two flags: the deployment makes
    /// Boxes, and the viewer is a team administrator.
    static func offered(boxAvailable: Bool?, canCreateBox: Bool?) -> Bool {
        boxAvailable == true && canCreateBox == true
    }

    /// Desktop's `nextBoxName`: "Computer N", after the highest the viewer has.
    static func defaultName(after labels: [String]) -> String {
        let taken = labels.compactMap { $0.wholeMatch(of: #/Computer (\d+)/#).flatMap { Int($0.1) } }
        return "Computer \((taken.max() ?? 0) + 1)"
    }

    /// `POST agent/devices/boxes`, Desktop's request: the backend picks the size.
    static let path = "agent/devices/boxes"
    struct Request: Encodable { let label: String; let teamId: String }

    /// The name shown as the default is the one sent.
    static func request(typed: String, labels: [String], teamId: String) -> Request {
        let label = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        return Request(label: label.isEmpty ? defaultName(after: labels) : label, teamId: teamId)
    }

    static func resumePath(deviceId: String) -> String { "agent/devices/\(deviceId)/box/resume" }

    struct Failure {
        /// The plan refused it (`402 box_vcpu_limit`), Desktop's paywall.
        let plan: Bool
        /// The server's own sentence.
        let message: String

        init(code: String?, message: String) {
            plan = code == "box_vcpu_limit"
            self.message = message
        }
    }

    enum Phase {
        case idle, starting, ready, error, timeout

        /// A Box's runtimes join one by one, so its list is read again while it starts
        /// and while it is shown, as Desktop's is.
        var reads: Bool { self == .starting || self == .ready }
    }

    /// Desktop's `boxSetupPhase`: up once the team lists one of its runtimes. A Box not
    /// listed yet is starting, as Desktop's unloaded list is: a failed read keeps the old one.
    static func phase(madeAt: Date?, now: Date, state: String?, runtimes: Int) -> Phase {
        guard let madeAt else { return .idle }
        if runtimes > 0 { return .ready }
        if state == "error" { return .error }
        return now.timeIntervalSince(madeAt) > 5 * 60 ? .timeout : .starting
    }

    /// Desktop's `BOX_BADGE` labels; nil for a running Box.
    static func stateLabel(_ state: String) -> String? {
        switch state {
        case "creating": String(localized: "Starting")
        case "connecting": String(localized: "Connecting")
        case "paused": String(localized: "Paused")
        case "error": String(localized: "Didn't start")
        default: nil
        }
    }

    /// Only its owner and managers may resume it, as on Desktop and the backend.
    static func resumable(state: String, access: String?) -> Bool {
        state == "paused" && access != "use"
    }
}
