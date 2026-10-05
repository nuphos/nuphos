import Foundation

/// Re-attaching to a run replays it from its first frame. Applied one at a
/// time, those frames are re-enacted — the transcript fast-forwards through
/// work that is already over — so a burst is held and handed back in one
/// piece, to be applied as state rather than as animation.
///
/// Nothing is reordered or dropped: `receive` returns exactly the frames it
/// was given, in order, just later.
struct StreamBacklog {
    struct Frame: Equatable {
        let value: JSONValue
        let type: String
    }

    /// Frames closer together than this belong to a replay rather than to a
    /// reply being written.
    static let frameGap: TimeInterval = 0.1
    /// How many of them in a row before holding starts.
    static let burstLength = 8
    /// The most frames held at once, so a long replay still shows progress.
    static let batchSize = 64
    /// The longest frames are ever held. A burst that stops — the replay has
    /// caught up, the agent is thinking — must not leave them waiting on a
    /// frame that may never come, and a stream that stays fast renders
    /// steadily at this rate rather than in jumps. Held at the short end of
    /// the 30–100ms band that reads as continuous: each commit lands about a
    /// word, rather than a clump long enough to see arrive.
    static let holdWindow: TimeInterval = 0.07
    /// Frames the user is waiting on go in the moment they arrive, however
    /// fast the stream is running.
    static let rendersImmediately: Set<String> = [
        "tool-approval-request", "atlas-turn-complete", "atlas-turn-paused",
        "atlas-stream-done", "atlas-transcript-snapshot", "error",
    ]

    /// A frame stamped (`emittedAt`) this long before it arrives was written
    /// before we attached: history the replay is catching up on.
    static let historyAge: TimeInterval = 2
    /// The longest history is held while it keeps arriving — a bound for a
    /// device clock far enough off that live frames look old.
    static let historyHoldLimit: TimeInterval = 1
    /// How long history must stop arriving before it lands. Wider than the
    /// hold window: a replay pauses ~100ms on a large tool output, and a
    /// split replay shows the turn filling in.
    static let historyQuiet: TimeInterval = 0.25

    private var held: [Frame] = []
    private var heldSince: Date?
    private var burst = 0
    private var lastFrameAt: Date = .distantPast
    /// When the held frames go in regardless of what else arrives.
    private(set) var deadline: Date?

    /// Whether frames are currently being held back.
    var isHolding: Bool { !held.isEmpty }

    /// The frames to apply now: empty while a replay is still arriving.
    mutating func receive(_ value: JSONValue, type: String, at now: Date) -> [Frame] {
        let gap = now.timeIntervalSince(lastFrameAt)
        lastFrameAt = now
        burst = gap < Self.frameGap ? burst + 1 : 0

        let frame = Frame(value: value, type: type)
        // History lands in one piece once it stops arriving, however long the
        // replay: played back in windows, the transcript re-enacts the turn.
        if Self.isHistory(value, at: now), !Self.rendersImmediately.contains(type) {
            if held.isEmpty { heldSince = now }
            held.append(frame)
            deadline = min(now.addingTimeInterval(Self.historyQuiet), (heldSince ?? now).addingTimeInterval(Self.historyHoldLimit))
            return now >= (deadline ?? now) ? flush() : []
        }
        if burst >= Self.burstLength, !Self.rendersImmediately.contains(type) {
            if held.isEmpty { deadline = now.addingTimeInterval(Self.holdWindow) }
            held.append(frame)
            guard held.count >= Self.batchSize || now >= (deadline ?? now) else { return [] }
            return flush()
        }
        return flush() + [frame]
    }

    /// The held frames once their window is up — what the scheduled flush
    /// applies when no further frame arrives to carry them in.
    mutating func framesDue(at now: Date) -> [Frame] {
        guard let deadline, now >= deadline else { return [] }
        return flush()
    }

    /// Everything held, for a stream that ended or went quiet.
    mutating func flush() -> [Frame] {
        defer { held = []; deadline = nil; heldSince = nil }
        return held
    }

    static func isHistory(_ value: JSONValue, at now: Date) -> Bool {
        guard let ms = value["emittedAt"]?.numberValue else { return false }
        return now.timeIntervalSince1970 - ms / 1000 > historyAge
    }
}
