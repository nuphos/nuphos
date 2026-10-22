import Foundation

enum AppLinkTests {
    static func run() {
        let team = "69e989027ab63e8d6a0ffcb6"
        let child = "6797aa32-c875-42d7-8530-1c635060bae5"
        func route(_ link: String) -> AppLink? { AppLink(URL(string: link)!) }
        func handoff(_ page: String) -> String {
            var components = URLComponents(string: "nuphos://open")!
            components.queryItems = [.init(name: "url", value: page), .init(name: "path", value: URL(string: page)?.path())]
            return components.url!.absoluteString
        }

        let session = "https://nuphos.ai/teams/\(team)/agent/\(child)"
        let plan = "https://nuphos.ai/teams/\(team)/plans/42"

        // A tapped nuphos.ai link and the page nuphos.ai hands over through
        // "Open in Nuphos" land on the same screen.
        for link in [session, handoff(session)] {
            precondition(route(link) == .session(teamId: team, sessionId: child), link)
        }
        for link in [plan, handoff(plan)] {
            precondition(route(link) == .plan(PlanLink.Target(teamId: team, planId: "42")), link)
        }
        precondition(route("/teams/\(team)/agent/\(child)") == .session(teamId: team, sessionId: child))

        // Pages without an app screen keep the app where it is.
        for page in [
            "https://nuphos.ai/teams/\(team)/devices/6654656b-87b7-c9a0-7f3a-5d7817b8b06e",
            "https://nuphos.ai/teams/\(team)/agent/memories",
            "https://nuphos.ai/teams/\(team)/infra/aws/793407052998",
            "https://nuphos.ai/",
        ] {
            precondition(route(page) == nil, page)
            precondition(route(handoff(page)) == nil, handoff(page))
        }

        // The hand-off carries no more trust than the page inside it.
        for link in [
            handoff("https://evil.com/teams/\(team)/agent/\(child)"),
            handoff("https://dev.nuphos.ai/teams/\(team)/agent/\(child)"),
            handoff("http://nuphos.ai/teams/\(team)/agent/\(child)"),
            handoff(handoff(session)),
            "nuphos://open?path=/teams/\(team)/agent/\(child)",
            "nuphos://agent-chat?url=\(session)",
            "nuphos://open",
        ] {
            precondition(route(link) == nil, link)
        }
        print("App link passed")
    }
}
