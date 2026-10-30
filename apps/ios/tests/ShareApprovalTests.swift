import Foundation

enum ShareApprovalTests {
    static func run() {
        readsHowATeammateSharesTheirComputer()
        waitsOnlyWhileTheOwnerHasNotApproved()
        watchesOnlyWhilePending()
        print("Share approval passed")
    }

    private static func runtime(_ json: String) -> RuntimeInstance {
        try! JSONDecoder().decode(RuntimeInstance.self, from: Data(json.utf8))
    }

    private static func readsHowATeammateSharesTheirComputer() {
        let local = #"{"ownerUserId":"owner","deviceId":"mac","deviceLabel":"Owner's Mac","signedIn":true"#
        let asks = runtime(#"{"id":"local_owner_mac","provider":"claude-code","label":"Claude Code in Owner's Mac (shared)","status":"active","kind":"local","local":"# + local + #","shared":{"level":"approve"}}}"#)
        let full = runtime(#"{"id":"local_owner_mac","provider":"claude-code","label":"x","status":"active","kind":"local","local":"# + local + #","shared":{"level":"full"}}}"#)
        let own = runtime(#"{"id":"local_me_mac","provider":"claude-code","label":"x","status":"active","kind":"local","local":"# + local + "}}")

        precondition(ShareApprovalWait.asksOwner(asks))
        precondition(!ShareApprovalWait.asksOwner(full))
        precondition(!ShareApprovalWait.asksOwner(own))
        precondition(!ShareApprovalWait.asksOwner(nil))
    }

    private static func waitsOnlyWhileTheOwnerHasNotApproved() {
        precondition(ShareApprovalWait(status: "pending") == .pending)
        precondition(ShareApprovalWait(status: "denied") == .denied)
        precondition(ShareApprovalWait(status: "approved") == nil)
        precondition(ShareApprovalWait(status: nil) == nil)
        precondition(ShareApprovalWait.pending.message(computer: "Mac").contains("Waiting for the owner of Mac"))
        let answer = try! JSONDecoder().decode(ShareApprovalStatus.self, from: Data(#"{"status":null}"#.utf8))
        precondition(answer.status == nil)
    }

    private static func watchesOnlyWhilePending() {
        precondition(ShareApprovalWait.keepsWatching(status: "pending"))
        precondition(!ShareApprovalWait.keepsWatching(status: "approved"))
        precondition(!ShareApprovalWait.keepsWatching(status: "denied"))
        precondition(!ShareApprovalWait.keepsWatching(status: nil))
    }
}
