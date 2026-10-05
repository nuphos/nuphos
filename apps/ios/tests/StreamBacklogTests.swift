import Foundation

enum StreamBacklogTests {
    static func run() {
        livesFramesStraightThrough()
        holdsAReplayedBurst()
        replayEndsWithTheSameMessageAsLiveStreaming()
        neverHoldsAFrameTheUserIsWaitingOn()
        landsHeldFramesWhenTheBurstStops()
        neverHoldsASlowTrickle()
        rendersAFastLiveStreamSteadily()
        landsReplayedHistoryInOnePiece()
        boundsHistoryHeldByASkewedClock()
        keepsUnstampedFramesBehindHistory()
        print("Stream backlog passed")
    }

    private static func delta(_ text: String, id: String = "t1") -> (JSONValue, String) {
        (.object(["type": .string("text-delta"), "id": .string(id), "delta": .string(text)]), "text-delta")
    }

    /// One frame per tick, far enough apart to be a reply being written.
    private static func livesFramesStraightThrough() {
        var backlog = StreamBacklog()
        var now = Date()
        for i in 0..<20 {
            now = now.addingTimeInterval(0.5)
            let (value, type) = delta("chunk\(i)")
            let out = backlog.receive(value, type: type, at: now)
            precondition(out.count == 1, "a live frame must go in on arrival, got \(out.count)")
            precondition(!backlog.isHolding)
        }
    }

    /// A replay arrives as fast as the socket can carry it.
    private static func holdsAReplayedBurst() {
        var backlog = StreamBacklog()
        var now = Date()
        var applied = 0
        for i in 0..<30 {
            now = now.addingTimeInterval(0.001)
            let (value, type) = delta("chunk\(i)")
            applied += backlog.receive(value, type: type, at: now).count
        }
        precondition(applied < 30, "a replayed burst must not be applied frame by frame, applied \(applied)")
        precondition(backlog.isHolding, "the rest is held until the stream catches up")
        // The live head arrives after a pause and brings the held frames with it.
        now = now.addingTimeInterval(0.6)
        let (value, type) = delta("live")
        let out = backlog.receive(value, type: type, at: now)
        precondition(applied + out.count == 31, "every frame goes in exactly once, got \(applied + out.count)")
        precondition(out.last?.type == "text-delta" && !backlog.isHolding)
    }

    /// Holding frames back must not change what the transcript ends up as.
    private static func replayEndsWithTheSameMessageAsLiveStreaming() {
        let frames = (0..<40).map { delta("chunk\($0) ") }

        var live = UIStreamReducer(message: ChatMessage(id: "m", role: .assistant, parts: []))
        for (value, _) in frames { _ = live.apply(value) }

        var backlog = StreamBacklog()
        var replay = UIStreamReducer(message: ChatMessage(id: "m", role: .assistant, parts: []))
        var now = Date()
        var order: [String] = []
        for (value, type) in frames {
            now = now.addingTimeInterval(0.001)
            for frame in backlog.receive(value, type: type, at: now) {
                _ = replay.apply(frame.value)
                order.append(frame.value["delta"]?.stringValue ?? "")
            }
        }
        for frame in backlog.flush() {
            _ = replay.apply(frame.value)
            order.append(frame.value["delta"]?.stringValue ?? "")
        }

        precondition(order == frames.map { $0.0["delta"]?.stringValue ?? "" }, "frames must keep their order")
        precondition(
            text(of: replay.message) == text(of: live.message),
            "replayed in bulk: \(text(of: replay.message)) vs live: \(text(of: live.message))"
        )
    }

    private static func neverHoldsAFrameTheUserIsWaitingOn() {
        var backlog = StreamBacklog()
        var now = Date()
        for i in 0..<20 {
            now = now.addingTimeInterval(0.001)
            _ = backlog.receive(delta("chunk\(i)").0, type: "text-delta", at: now)
        }
        precondition(backlog.isHolding)
        now = now.addingTimeInterval(0.001)
        let approval = JSONValue.object(["type": .string("tool-approval-request")])
        let out = backlog.receive(approval, type: "tool-approval-request", at: now)
        precondition(out.last?.type == "tool-approval-request", "an approval request goes in on arrival")
        precondition(out.count > 1, "and it brings the held frames with it")
        precondition(!backlog.isHolding)
    }

    /// The burst stops — the replay caught up and the agent is thinking —
    /// and no further frame arrives. What is held must still land, or the
    /// transcript sits frozen half-way through a reply.
    private static func landsHeldFramesWhenTheBurstStops() {
        var backlog = StreamBacklog()
        var now = Date()
        for i in 0..<12 {
            now = now.addingTimeInterval(0.001)
            _ = backlog.receive(delta("chunk\(i)").0, type: "text-delta", at: now)
        }
        precondition(backlog.isHolding, "the burst is held")
        guard let deadline = backlog.deadline else { preconditionFailure("held frames must carry a deadline") }
        precondition(
            deadline.timeIntervalSince(now) <= StreamBacklog.holdWindow,
            "the wait must be bounded by the hold window"
        )
        precondition(backlog.framesDue(at: now).isEmpty, "nothing is due before the window is up")
        let due = backlog.framesDue(at: deadline)
        precondition(!due.isEmpty, "the held frames land on their own once the window is up")
        precondition(!backlog.isHolding && backlog.deadline == nil)
    }

    /// Frames spaced further apart than the burst threshold are a reply being
    /// written, and are never held.
    private static func neverHoldsASlowTrickle() {
        var backlog = StreamBacklog()
        var now = Date()
        for i in 0..<30 {
            now = now.addingTimeInterval(StreamBacklog.frameGap * 2)
            let out = backlog.receive(delta("chunk\(i)").0, type: "text-delta", at: now)
            precondition(out.count == 1 && !backlog.isHolding, "a trickle is never held")
        }
    }

    /// A model typing fast emits deltas closer together than the threshold
    /// for a long time. That must render continuously — coalesced into the
    /// hold window — rather than in batch-sized jumps.
    private static func rendersAFastLiveStreamSteadily() {
        var backlog = StreamBacklog()
        var now = Date()
        var applied = 0
        var longestWait: TimeInterval = 0
        var heldSince: Date?
        for i in 0..<600 {
            now = now.addingTimeInterval(0.01)
            let out = backlog.receive(delta("chunk\(i)").0, type: "text-delta", at: now)
            if let deadline = backlog.deadline, now >= deadline {
                // What the scheduled flush would do at this moment.
                let due = backlog.framesDue(at: now)
                applied += due.count
                if !due.isEmpty, let since = heldSince { longestWait = max(longestWait, now.timeIntervalSince(since)) }
                heldSince = nil
            }
            if backlog.isHolding, heldSince == nil { heldSince = now }
            applied += out.count
            if !out.isEmpty, let since = heldSince {
                longestWait = max(longestWait, now.timeIntervalSince(since))
                heldSince = nil
            }
        }
        applied += backlog.flush().count
        precondition(applied == 600, "every frame is applied exactly once, got \(applied)")
        precondition(
            longestWait <= StreamBacklog.holdWindow + 0.02,
            "a fast stream still renders every hold window, waited \(longestWait)s"
        )
    }

    private static func text(of message: ChatMessage) -> String {
        message.parts.compactMap { if case .text(let p) = $0 { return p.text } else { return nil } }.joined()
    }

    private static func stamped(_ text: String, emittedAt: Date) -> JSONValue {
        .object(["type": .string("text-delta"), "id": .string("t1"), "delta": .string(text), "emittedAt": .number(emittedAt.timeIntervalSince1970 * 1000)])
    }

    /// Re-attaching to a long turn replays thousands of frames written long
    /// ago. They must land as one state change, not be played back.
    private static func landsReplayedHistoryInOnePiece() {
        var backlog = StreamBacklog()
        var now = Date()
        let written = now.addingTimeInterval(-60)
        for i in 0..<500 {
            now = now.addingTimeInterval(0.001)
            let out = backlog.receive(stamped("chunk\(i)", emittedAt: written), type: "text-delta", at: now)
            precondition(out.isEmpty, "history must not be applied while it is still arriving, frame \(i)")
        }
        guard let deadline = backlog.deadline else { preconditionFailure("held history must carry a deadline") }
        let due = backlog.framesDue(at: deadline)
        precondition(due.count == 500, "the whole replay lands at once, got \(due.count)")

        // The live head is not history and goes straight in.
        now = deadline.addingTimeInterval(0.5)
        let live = backlog.receive(stamped("live", emittedAt: now), type: "text-delta", at: now)
        precondition(live.count == 1 && !backlog.isHolding, "a live frame goes in on arrival")
    }

    /// A device clock minutes ahead makes every frame look old. Rendering
    /// may coarsen, but never stall for longer than the history limit.
    private static func boundsHistoryHeldByASkewedClock() {
        var backlog = StreamBacklog()
        let start = Date()
        var now = start
        var applied = 0
        while now.timeIntervalSince(start) < 3 {
            now = now.addingTimeInterval(0.03)
            applied += backlog.receive(stamped("x", emittedAt: now.addingTimeInterval(-300)), type: "text-delta", at: now).count
            precondition(now.timeIntervalSince(start) < StreamBacklog.historyHoldLimit + 0.1 || applied > 0, "held past the limit")
        }
        precondition(applied > 0, "a stream that never pauses still renders")
    }

    /// Some replayed frames carry no stamp. One arriving mid-replay must not
    /// release the history held so far, or the turn lands in two halves.
    private static func keepsUnstampedFramesBehindHistory() {
        var backlog = StreamBacklog()
        var now = Date()
        let written = now.addingTimeInterval(-60)
        for i in 0..<10 {
            now = now.addingTimeInterval(0.001)
            _ = backlog.receive(stamped("old\(i)", emittedAt: written), type: "text-delta", at: now)
        }
        now = now.addingTimeInterval(0.001)
        let unstamped = backlog.receive(delta("plain").0, type: "text-delta", at: now)
        precondition(unstamped.isEmpty, "an unstamped frame queues behind held history, got \(unstamped.count)")
        for i in 0..<10 {
            now = now.addingTimeInterval(0.001)
            _ = backlog.receive(stamped("more\(i)", emittedAt: written), type: "text-delta", at: now)
        }
        guard let deadline = backlog.deadline else { preconditionFailure("held frames must carry a deadline") }
        let due = backlog.framesDue(at: deadline)
        precondition(due.count == 21, "the whole replay lands at once, got \(due.count)")
        precondition(due[10].value["delta"]?.stringValue == "plain", "and keeps its order")
    }
}
