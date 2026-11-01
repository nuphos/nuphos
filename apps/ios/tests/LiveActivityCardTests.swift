import Foundation

enum LiveActivityCardTests {
    static func run() {
        typealias Phase = TurnActivityAttributes.Phase
        func card(_ phases: [Phase], more: Int = 0) -> TurnActivityAttributes.ContentState {
            let sessions = phases.enumerated().map {
                TurnActivityAttributes.Session(id: "s\($0.offset)", teamId: "t", title: "", phase: $0.element)
            }
            return .init(sessions: sessions, more: more, active: phases.filter(\.isActive).count)
        }
        precondition(card([.done, .stopped]).finished)
        // An unreachable runtime is not done, even with nothing running.
        precondition(card([.done, .unavailable]).active == 0 && !card([.done, .unavailable]).finished)
        precondition(!card([.unavailable]).finished)
        precondition(!card([.running, .done]).finished && !card([.approval]).finished)
        // Rows past the shown ones are unknown here.
        precondition(!card([.done, .done, .done], more: 1).finished)
    }
}
