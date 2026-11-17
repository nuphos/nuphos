import Foundation

/// What the composer's one trailing button does right now. The composer never
/// offers two of these at once: the turn's state and what is typed decide
/// between them.
enum ComposerAction: Equatable {
    /// No turn is running: the message starts one.
    case send
    /// A turn is running and nothing is typed: the button stops it.
    case stop
    /// A turn is running and it takes messages mid-flight.
    case steer
    /// A turn is running that cannot take the message, so it waits its turn.
    case queue

    var systemImage: String {
        switch self {
        case .send: "arrow.up"
        case .stop: "stop.fill"
        case .steer: "arrow.turn.up.right"
        case .queue: "text.badge.plus"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .send: String(localized: "Send")
        case .stop: String(localized: "Stop")
        case .steer: String(localized: "Send to the current reply")
        case .queue: String(localized: "Queue message")
        }
    }

    /// `isStreaming` is the turn; `canSteer` and `sendsDuringTurn` say whether
    /// this runtime takes a message while one runs; `canStop` is whether the
    /// turn can still be cancelled.
    static func current(
        isStreaming: Bool,
        hasPayload: Bool,
        canSteer: Bool,
        sendsDuringTurn: Bool,
        canStop: Bool
    ) -> ComposerAction {
        guard isStreaming else { return .send }
        guard hasPayload else { return canStop ? .stop : .send }
        if canSteer { return .steer }
        if sendsDuringTurn { return .send }
        return .queue
    }
}
