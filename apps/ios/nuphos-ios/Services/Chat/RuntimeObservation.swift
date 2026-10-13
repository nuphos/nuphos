import Foundation
import Observation

/// A received runtime document, never a client-owned execution state machine.
struct RuntimeObservation: Equatable, Sendable {
    let snapshot: JSONValue
    let observedAt: TimeInterval
    var epoch: String? { snapshot["epoch"]?.stringValue }
    var revision: Double? { snapshot["revision"]?.numberValue }
    var phase: String? { snapshot["phase"]?.stringValue }
    func fresh(at now: TimeInterval) -> Bool { now >= observedAt && now - observedAt < 12 }
    func allows(_ action: String, at now: TimeInterval) -> Bool {
        fresh(at: now) && snapshot["schemaVersion"]?.numberValue == 2 && snapshot["actions"]?[action]?.boolValue == true
    }
    func executing(at now: TimeInterval) -> Bool { fresh(at: now) && snapshot["state"]?.stringValue == "active" }
    /// A user-visible turn, including a queued or running automatic continuation.
    func turnActive(at now: TimeInterval) -> Bool { executing(at: now) && phase != "resume_disconnected" }
    /// The turn ended while runtime-owned background tools or tasks keep running.
    func backgroundRunning(at now: TimeInterval) -> Bool {
        !turnActive(at: now) && fresh(at: now) && snapshot["schemaVersion"]?.numberValue == 2 && phase == "background_tools"
    }
    func paused(at now: TimeInterval) -> Bool { fresh(at: now) && phase == "resume_disconnected" }
    /// The server answered but had no usable status: the runtime is
    /// unreachable, or too old to report one. Deliberately independent of
    /// `fresh` — time spent on another screen does not make a status
    /// unknown, it only makes the one we hold older.
    var unavailable: Bool {
        guard snapshot["schemaVersion"]?.numberValue == 2 else { return true }

        return ["disconnected", "unsupported"].contains(snapshot["state"]?.stringValue ?? "")
    }
    func accepts(_ next: Self) -> Bool {
        if let epoch, epoch == next.epoch, let revision, let other = next.revision, other < revision { return false }
        if next.observedAt < observedAt && (epoch != next.epoch || revision == next.revision) { return false }
        return true
    }
    func status(at now: TimeInterval) -> String? {
        guard fresh(at: now), snapshot["state"]?.stringValue != "disconnected" else { return "Connection lost — runtime status unavailable" }
        guard snapshot["schemaVersion"]?.numberValue == 2 else { return "Runtime status unavailable — runtime update required" }
        guard !["idle", "dormant", "cancelled"].contains(phase ?? "") else { return nil }
        return snapshot["label"]?.stringValue ?? "Runtime: \(phase ?? snapshot["state"]?.stringValue ?? "unknown")"
    }
}

/// A running turn outranks background work, which outranks an unread reply.
enum ConversationIndicator: Equatable {
    case turn, background, unread, none

    init(_ observation: RuntimeObservation?, at now: TimeInterval, unread: Bool) {
        if observation?.turnActive(at: now) == true { self = .turn }
        else if observation?.backgroundRunning(at: now) == true { self = .background }
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
    private(set) var now = ProcessInfo.processInfo.systemUptime
    func tick() { now = ProcessInfo.processInfo.systemUptime }
    func value(team: String, session: String) -> RuntimeObservation? { values["\(team)/\(session)"] }
    func receive(_ snapshot: JSONValue?, team: String, session: String, observedAt: TimeInterval) {
        guard let snapshot else { return }
        let key = "\(team)/\(session)"
        let next = RuntimeObservation(snapshot: snapshot, observedAt: observedAt)
        guard values[key]?.accepts(next) != false else { return }
        values[key] = next
        tick()
    }
}
