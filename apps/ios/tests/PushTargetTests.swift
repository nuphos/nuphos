import Foundation

private func check(_ condition: Bool, _ message: String) {
    if !condition { print("FAIL: \(message)"); exit(1) }
}

@main
enum PushTargetTests {
    static func main() {
        // A notification's title names the chat it opens before the chat is listed.
        let titled = PushTarget(userInfo: ["teamId": "t1", "sessionId": "s1", "aps": ["alert": ["title": "Weekly report", "body": "Done"]]])
        check(titled?.title == "Weekly report", "a notification's own title is kept, got \(String(describing: titled?.title))")

        // Without one, it is called a Task, the same as a target made from a link.
        let untitled = PushTarget(userInfo: ["teamId": "t1", "sessionId": "s1", "aps": ["alert": ["body": "Done"]]])
        check(untitled?.title == "Task", "a notification without a title opens as \"Task\", got \(String(describing: untitled?.title))")
        check(untitled?.title == PushTarget(teamId: "t1", sessionId: "s1").title, "both initializers use the same fallback title")
        let bare = PushTarget(userInfo: ["teamId": "t1", "sessionId": "s1"])
        check(bare?.title == "Task", "a notification without an alert opens as \"Task\", got \(String(describing: bare?.title))")

        // Without a team and a session there is nothing to open.
        check(PushTarget(userInfo: ["sessionId": "s1"]) == nil, "a notification without a team opens nothing")
        check(PushTarget(userInfo: ["teamId": "t1", "sessionId": ""]) == nil, "a notification with an empty session opens nothing")

        print("PushTargetTests: ok")
    }
}
