import Foundation
import Observation

/// A received runtime document, never a client-owned execution state machine.
struct RuntimeObservation: Equatable, Sendable {
    let snapshot: JSONValue
    let observedAt: TimeInterval
    var epoch: String? { snapshot["epoch"]?.stringValue }
    var revision: Double? { snapshot["revision"]?.numberValue }
    var phase: String? { snapshot["phase"]?.stringValue }
    /// Desktop's `runtimeMayAcceptLater`: a message this runtime cannot take
    /// now waits in the session queue. Only a runtime too old to report its
    /// state is not waited on.
    var mayAcceptLater: Bool { snapshot["schemaVersion"]?.numberValue == 2 || snapshot["state"]?.stringValue == "disconnected" }
    func allows(_ action: String) -> Bool {
        snapshot["schemaVersion"]?.numberValue == 2 && snapshot["actions"]?[action]?.boolValue == true
    }
    var executing: Bool { snapshot["state"]?.stringValue == "active" }
    /// A user-visible turn, including a queued or running automatic continuation.
    var turnActive: Bool { executing && phase != "resume_disconnected" }
    /// The turn ended while runtime-owned background tools or tasks keep running.
    var backgroundRunning: Bool {
        !turnActive && snapshot["schemaVersion"]?.numberValue == 2 && phase == "background_tools"
    }
    var paused: Bool { phase == "resume_disconnected" }
    /// The server answered but had no usable status: the runtime is
    /// unreachable, or too old to report one. Time spent in the background
    /// or on another screen does not make a status unknown, it only makes
    /// the one we hold older; the next read replaces it.
    var unavailable: Bool {
        guard snapshot["schemaVersion"]?.numberValue == 2 else { return true }

        return ["disconnected", "unsupported"].contains(snapshot["state"]?.stringValue ?? "")
    }
    func accepts(_ next: Self) -> Bool {
        if let epoch, epoch == next.epoch, let revision, let other = next.revision, other < revision { return false }
        if next.observedAt < observedAt && (epoch != next.epoch || revision == next.revision) { return false }
        return true
    }
    var status: String? {
        guard snapshot["state"]?.stringValue != "disconnected" else { return "Connection lost — runtime status unavailable" }
        guard snapshot["schemaVersion"]?.numberValue == 2 else { return "Runtime status unavailable — runtime update required" }
        guard !["idle", "dormant", "cancelled"].contains(phase ?? "") else { return nil }
        return snapshot["label"]?.stringValue ?? "Runtime: \(phase ?? snapshot["state"]?.stringValue ?? "unknown")"
    }
}

/// A running turn outranks background work, which outranks an unread reply.
enum ConversationIndicator: Equatable {
    case turn, background, unread, none

    init(_ observation: RuntimeObservation?, unread: Bool) {
        if observation?.turnActive == true { self = .turn }
        else if observation?.backgroundRunning == true { self = .background }
        else { self = unread ? .unread : .none }
    }

    /// Which state wins when one row shows several (a folded thread parent).
    var urgency: Int {
        switch self {
        case .turn: 3
        case .background: 2
        case .unread: 1
        case .none: 0
        }
    }
}

/// Shared read-only observations for the chat and conversation list.
@Observable
final class RuntimeObservations {
    static let shared = RuntimeObservations()
    private var values: [String: RuntimeObservation] = [:]
    func value(team: String, session: String) -> RuntimeObservation? { values["\(team)/\(session)"] }
    func receive(_ snapshot: JSONValue?, team: String, session: String, observedAt: TimeInterval) {
        guard let snapshot else { return }
        let key = "\(team)/\(session)"
        let next = RuntimeObservation(snapshot: snapshot, observedAt: observedAt)
        guard values[key]?.accepts(next) != false else { return }
        values[key] = next
    }
}
