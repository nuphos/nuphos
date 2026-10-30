import Foundation

/// Where a conversation on a teammate's computer shared at "Ask me first"
/// stands with that computer's owner: its messages wait until they approve.
enum ShareApprovalWait: Equatable, Sendable {
    case pending, denied

    /// `GET /agent/devices/share-approvals/mine`: nothing to show once approved, or never asked.
    init?(status: String?) {
        switch status {
        case "pending": self = .pending
        case "denied": self = .denied
        default: return nil
        }
    }

    /// Whether to ask again: only a pending request can still change. Approved, declined and
    /// never-asked conversations stop, and the next queued send starts watching again.
    static func keepsWatching(status: String?) -> Bool {
        status == "pending"
    }

    /// Only a computer that asks its owner first has anything to wait for.
    static func asksOwner(_ runtime: RuntimeInstance?) -> Bool {
        runtime?.local?.shared?.level == "approve"
    }

    func message(computer: String) -> String {
        switch self {
        case .pending: "Waiting for the owner of \(computer) to approve. Your message is sent once they do."
        case .denied: "The owner of \(computer) declined this conversation. Move it to another agent to continue."
        }
    }
}

/// The caller's own answer for one conversation; nil status when they were never asked.
struct ShareApprovalStatus: Decodable, Sendable {
    let status: String?
}
