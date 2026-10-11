import Foundation

enum SessionLinkTests {
    static func run() {
        buildsTheDesktopSessionURL()
        usesTheConversationsOwnTeam()
        escapesSegmentsAndRefusesEmptyOnes()
        labelsLinkedResources()
        print("Session link passed")
    }

    private static func url(_ team: String, _ session: String) -> String? {
        SessionLink.url(teamId: team, sessionId: session)?.absoluteString
    }

    private static func buildsTheDesktopSessionURL() {
        precondition(
            url("team-1", "ses_abc") == "https://nuphos.ai/teams/team-1/agent/ses_abc",
            "expected desktop's /teams/<team>/agent/<session> form, got \(String(describing: url("team-1", "ses_abc")))"
        )
    }

    private static func usesTheConversationsOwnTeam() {
        // A chat opened from another team keeps that team in its link rather
        // than whichever team happens to be selected.
        precondition(url("other-team", "ses_abc") == "https://nuphos.ai/teams/other-team/agent/ses_abc")
        precondition(url("team-1", "ses_abc") != url("other-team", "ses_abc"))
    }

    private static func escapesSegmentsAndRefusesEmptyOnes() {
        precondition(url("team/with space", "a b") == "https://nuphos.ai/teams/team%2Fwith%20space/agent/a%20b")
        precondition(SessionLink.url(teamId: "", sessionId: "ses_abc") == nil)
        precondition(SessionLink.url(teamId: "team-1", sessionId: "") == nil)
    }

    private static func labelsLinkedResources() {
        struct List: Decodable { let resources: [SessionResource] }
        let json = #"""
        {"resources":[
          {"id":"r1","provider":"github","title":"Fix the picker","url":"https://github.com/nuphos/nuphos/pull/165","state":"merged","repository":"nuphos/nuphos","number":165,"linkedAt":"2026-10-11T05:57:37.006Z"},
          {"id":"r2","provider":"linear","title":"NUPS-1022 Switch agents on iOS","url":"https://linear.app/zeabur/issue/NUPS-1022","state":"In Progress","linkedAt":"2026-10-11T05:57:37.006Z"}
        ],"canManage":true}
        """#
        let resources = try! JSONDecoder().decode(List.self, from: Data(json.utf8)).resources
        // A pull request's title says nothing about where it lives; a Linear
        // title already leads with its identifier.
        precondition(resources.map(\.label) == ["nuphos#165 · Fix the picker", "NUPS-1022 Switch agents on iOS"])
    }
}
