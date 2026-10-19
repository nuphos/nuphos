import ActivityKit
import Foundation

/// A conversation's turn on the Lock Screen and in the Dynamic Island. The
/// app starts it while a turn runs; the backend's `liveactivity` push moves
/// it to approval or ends it (`apps/backend/src/lib/push/live-activities.ts`).
nonisolated struct TurnActivityAttributes: ActivityAttributes {
    /// Matches the backend's `LiveActivityPhase`.
    enum Phase: String, Codable, Hashable, Sendable {
        case running, approval, done, failed, stopped
    }

    struct ContentState: Codable, Hashable, Sendable {
        var phase: Phase
        /// Unix seconds; the push that ends the turn sets it.
        var endedAt: Double?
    }

    let sessionId: String
    let title: String
    /// Asset name of the agent's mark.
    let logo: String
    /// The agent, or the computer it runs on.
    let runtime: String?
    let startedAt: Date
    let url: URL?
}
