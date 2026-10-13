import Foundation

enum SessionLinkTests {
    static func run() {
        buildsTheDesktopSessionURL()
        usesTheConversationsOwnTeam()
        escapesSegmentsAndRefusesEmptyOnes()
        chipsLinkedResources()
        readsSessionLinksBack()
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

    private static func readsSessionLinksBack() {
        let team = "6a6198d06a7585a89e02775d"
        func target(_ link: String) -> String? {
            SessionLink.target(in: URL(string: link)!).map { "\($0.teamId)|\($0.sessionId)" }
        }
        precondition(target("https://nuphos.ai/teams/\(team)/agent/ses_abc") == "\(team)|ses_abc")
        precondition(target("https://nuphos.ai/teams/\(team)/agent/ses_abc?x=1#y") == "\(team)|ses_abc")
        precondition(target("/teams/\(team)/agent/0f8e2c1a-9b7d-4e6f-a5c3-2d1b0e9f8a7c") == "\(team)|0f8e2c1a-9b7d-4e6f-a5c3-2d1b0e9f8a7c")
        precondition(target(SessionLink.url(teamId: team, sessionId: "ses_abc")!.absoluteString) == "\(team)|ses_abc")
        // Pages under /agent are not sessions (desktop's AGENT_SUBPAGE_SEGMENTS).
        for page in ["memories", "skills", "archived"] {
            precondition(target("https://nuphos.ai/teams/\(team)/agent/\(page)") == nil, page)
        }
        precondition(target("https://nuphos.ai/teams/\(team)/agent/skills/aws") == nil)
        // Ids are never decoded, so an encoded slash cannot reach an API path.
        precondition(target("https://nuphos.ai/teams/\(team)/agent/a%2F..%2F..%2Fx") == nil)
        precondition(target("https://nuphos.ai/teams/team-1/agent/ses_abc") == nil)
        // Only the exact web origin: look-alikes, other schemes, ports and
        // subdomains still leave the app.
        for link in [
            "https://nuphos.ai.evil.com/teams/\(team)/agent/ses_abc",
            "https://evilnuphos.ai/teams/\(team)/agent/ses_abc",
            "https://nuphos.ai@evil.com/teams/\(team)/agent/ses_abc",
            "https://dev.nuphos.ai/teams/\(team)/agent/ses_abc",
            "http://nuphos.ai/teams/\(team)/agent/ses_abc",
            "https://nuphos.ai:8443/teams/\(team)/agent/ses_abc",
            "https://example.com/teams/\(team)/agent/ses_abc",
            "https://nuphos.ai/teams/\(team)/plans/7",
            "https://nuphos.ai/teams/\(team)/agent",
            "mailto:a@nuphos.ai",
        ] {
            precondition(target(link) == nil, link)
        }
    }

    private static func chipsLinkedResources() {
        struct List: Decodable { let resources: [SessionResource] }
        let json = #"""
        {"resources":[
          {"id":"r1","provider":"github","title":"Fix the picker","url":"https://github.com/nuphos/nuphos/pull/165","state":"merged","repository":"nuphos/nuphos","number":165,"linkedAt":"2026-10-11T05:57:37.006Z"},
          {"id":"r2","provider":"linear","title":"NUPS-1022 Switch agents on iOS","url":"https://linear.app/zeabur/issue/NUPS-1022","state":"In Progress","linkedAt":"2026-10-11T05:57:37.006Z"}
        ],"canManage":true}
        """#
        let resources = try! JSONDecoder().decode(List.self, from: Data(json.utf8)).resources
        precondition(resources.map(\.chip) == ["#165", "NUPS-1022"])
    }
}
