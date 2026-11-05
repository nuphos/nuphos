import Foundation

/// Replays the Share Extension's lifecycle against the same follow rule as
/// AgentStore: following the followed session again starts nothing new.
private struct Follower {
    private(set) var polling = false
    private(set) var started = 0

    mutating func apply(_ state: ShareFollowState) {
        if state.isOpen {
            if !polling { polling = true; started += 1 }
        } else {
            polling = false
        }
    }
}

private func check(_ condition: Bool, _ message: String) {
    if !condition { print("FAIL: \(message)"); exit(1) }
}

@main
struct ShareFollowStateTests {
    static func main() {
        var follower = Follower()
        var state = ShareFollowState(shown: false, active: true, permitted: true)
        follower.apply(state)
        check(!follower.polling, "nothing polls before the conversation is shown")

        state.shown = true; follower.apply(state)
        follower.apply(state)
        check(follower.polling && follower.started == 1, "shown and active polls once")

        state.active = false; follower.apply(state)
        check(!follower.polling, "leaving the foreground stops the poll")

        state.active = true; follower.apply(state)
        check(follower.polling && follower.started == 2, "returning to the foreground resumes one poll")

        state.shown = false; follower.apply(state)
        check(!follower.polling, "disappearing stops the poll")

        state.shown = true; follower.apply(state)
        check(follower.polling && follower.started == 3, "showing it again resumes one poll")

        state.permitted = false; follower.apply(state)
        check(!follower.polling, "a cancelled share or lost identity stops the poll")

        state.active = false; follower.apply(state)
        state.active = true; follower.apply(state)
        check(!follower.polling && follower.started == 3, "returning to the foreground does not resume after that")

        print("PASS: shared conversation polls only while shown, active and permitted")
    }
}
