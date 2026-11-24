import Foundation

private func check(_ condition: Bool, _ message: String) {
    if !condition { print("FAIL: \(message)"); exit(1) }
}

private func queue(_ json: String) -> AgentChatAPI.Queue {
    try! AgentChatAPI.decodeQueue(Data(json.utf8))
}

private let message = #"{"id":"q1","source":"app","senderUserId":"u1","mine":true,"text":"Next","receivedAt":"2026-11-24T05:00:00.000Z"}"#

/// The queue the usage limit holds says so, as Desktop's strip does (#4573).
@main
enum QueueHoldTests {
    static func main() {
        readsAUsageHoldWithItsReset()
        readsAUsageHoldWithoutAReset()
        readsAQueueThatIsNotHeld()
        ignoresAnotherReason()
        saysWhenTheHeldQueueRuns()
        print("Queue hold passed")
    }

    private static func readsAUsageHoldWithItsReset() {
        let read = queue(#"{"held":{"reason":"usage_limit","until":"2026-11-24T06:30:00.000Z"},"messages":[\#(message)]}"#)
        check(read.messages.map(\.id) == ["q1"], "the messages are read alongside the hold")
        check(read.held?.until == Date(timeIntervalSince1970: 1_795_501_800), "a usage hold keeps its reset")
        let plain = queue(#"{"held":{"reason":"usage_limit","until":"2026-11-24T06:30:00Z"},"messages":[]}"#)
        check(plain.held?.until == Date(timeIntervalSince1970: 1_795_501_800), "a reset without fractional seconds reads too")
    }

    private static func readsAUsageHoldWithoutAReset() {
        check(queue(#"{"held":{"reason":"usage_limit"},"messages":[]}"#).held == AgentChatAPI.QueueHold(until: nil),
              "a usage hold with an unknown reset is still a hold")
        check(queue(#"{"held":{"reason":"usage_limit","until":"soon"},"messages":[]}"#).held == AgentChatAPI.QueueHold(until: nil),
              "an unreadable reset reads as unknown")
    }

    private static func readsAQueueThatIsNotHeld() {
        let read = queue(#"{"messages":[\#(message)]}"#)
        check(read.held == nil && read.messages.count == 1, "a queue without held is not held")
    }

    private static func ignoresAnotherReason() {
        check(queue(#"{"held":{"reason":"approval"},"messages":[]}"#).held == nil, "only the usage limit counts as a hold")
    }

    private static func saysWhenTheHeldQueueRuns() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        func notice(_ minutes: Double?) -> String {
            AgentChatAPI.QueueHold(until: minutes.map { now.addingTimeInterval($0 * 60) }).notice(now: now)
        }
        check(notice(90) == "Out of usage. These run when usage resets in 1h 30m.", "hours and minutes")
        check(notice(2 * 1440 + 5 * 60) == "Out of usage. These run when usage resets in 2d 5h.", "days and hours")
        check(notice(12) == "Out of usage. These run when usage resets in 12m.", "minutes")
        check(notice(nil) == "Out of usage. These run when usage resets.", "an unknown reset")
        check(notice(-5) == "Out of usage. These run when usage resets.", "a reset that has passed")
    }
}
