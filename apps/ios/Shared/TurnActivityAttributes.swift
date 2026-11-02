#if os(iOS)
import ActivityKit
typealias TurnActivityBase = ActivityAttributes
#else
// The macOS test build has no ActivityKit; the card's own logic still compiles.
protocol TurnActivityBase: Codable {}
#endif
import Foundation

/// The app's one Live Activity: the conversations whose turns run, on the Lock
/// Screen and in the Dynamic Island. The backend's `liveactivity` pushes start
/// it when a watched conversation runs, add later ones, keep each row on the
/// runtime's own status and end it once nothing runs
/// (`apps/backend/src/lib/push/live-activities.ts`).
nonisolated struct TurnActivityAttributes: TurnActivityBase {
    /// Matches the backend's `LiveActivityPhase`.
    enum Phase: String, Codable, Hashable, Sendable {
        case running, approval, done, stopped, unavailable

        /// Still needs the card: running, or waiting for approval.
        var isActive: Bool { self == .running || self == .approval }
        /// Nothing more will happen on this row. An unavailable runtime may come back.
        var isFinished: Bool { self == .done || self == .stopped }
    }

    struct Session: Codable, Hashable, Sendable, Identifiable {
        let id: String
        let teamId: String
        let title: String
        var phase: Phase
    }

    /// Matches the backend's `liveActivityCard`.
    struct ContentState: Codable, Hashable, Sendable {
        /// The most recently updated first, at most `rows` of them.
        var sessions: [Session]
        /// Conversations past those.
        var more: Int
        /// Running or waiting for approval, shown or not.
        var active: Int

        static let rows = 3

        /// Every row finished, so the card can show its check. With rows past
        /// the shown ones it cannot tell, so it does not claim it.
        var finished: Bool { more == 0 && sessions.allSatisfy(\.phase.isFinished) }

        /// Moves `session` to the top, as the backend orders it.
        mutating func put(_ session: Session) {
            let old = sessions.firstIndex { $0.id == session.id }.map { sessions.remove(at: $0) }
            active += (session.phase.isActive ? 1 : 0) - (old?.phase.isActive == true ? 1 : 0)
            sessions.insert(session, at: 0)
            if sessions.count > Self.rows {
                sessions.removeLast()
                more += 1
            }
        }
    }
}
