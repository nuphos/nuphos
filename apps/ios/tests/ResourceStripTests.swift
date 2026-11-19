import Foundation

enum ResourceStripTests {
    static func run() {
        openLinksComeFirstInLinkOrder()
        theFoldedChipNamesWhatFinished()
        aLinearIssueFollowsItsStateType()
        print("Resource strip passed")
    }

    private static func pr(_ number: Int, _ state: String) -> SessionResource {
        SessionResource(
            id: "pr-\(number)", provider: "github", title: "PR \(number)",
            url: URL(string: "https://github.com/example/repo/pull/\(number)")!,
            state: state, repository: "example/repo", number: number
        )
    }

    private static func issue(_ id: String, _ stateType: String) -> SessionResource {
        SessionResource(
            id: id, provider: "linear", title: "\(id) An issue",
            url: URL(string: "https://linear.app/example/issue/\(id)")!,
            state: "State", stateType: stateType, repository: nil, number: nil
        )
    }

    private static func openLinksComeFirstInLinkOrder() {
        let groups = [pr(29, "merged"), pr(2172, "open"), pr(2173, "closed"), pr(2417, "open")].openFirst
        precondition(groups.open.map(\.chip) == ["#2172", "#2417"])
        precondition(groups.finished.map(\.chip) == ["#29", "#2173"])
    }

    private static func theFoldedChipNamesWhatFinished() {
        precondition(SessionResource.finishedLabel([pr(1, "merged"), pr(2, "merged"), pr(3, "closed")]) == "2 merged")
        precondition(SessionResource.finishedLabel([pr(1, "closed")]) == "1 closed")
        precondition(SessionResource.finishedLabel([issue("NUPS-1", "completed")]) == "1 done")
    }

    private static func aLinearIssueFollowsItsStateType() {
        let groups = [issue("NUPS-1", "started"), issue("NUPS-2", "canceled"), issue("NUPS-3", "completed")].openFirst
        precondition(groups.open.map(\.chip) == ["NUPS-1"])
        precondition(groups.finished.map(\.chip) == ["NUPS-2", "NUPS-3"])
    }
}
