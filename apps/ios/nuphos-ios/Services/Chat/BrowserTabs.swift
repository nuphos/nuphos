import Foundation

/// A browser tab in this conversation's dock, in the owner's Nuphos Desktop: opened by the agent
/// or the user, open now or restored after a restart. The page itself stays on that computer:
/// its cookies and sign-ins never reach the phone.
struct BrowserTab: Decodable, Identifiable, Equatable, Sendable {
    /// The dock tab's id on that computer, which `focus` names.
    let id: String
    let url: String
    let title: String
    /// The site, shown under the title.
    var host: String { URL(string: url)?.host() ?? url }
    /// The site's conventional icon; a site without one shows a globe instead.
    var favicon: URL? {
        guard var parts = URLComponents(string: url), parts.host != nil else { return nil }
        parts.path = "/favicon.ico"
        parts.query = nil
        parts.fragment = nil
        return parts.url
    }
}

extension AgentChatAPI {
    /// `GET /teams/:teamId/browser-tabs/:sessionId`: asks the owner's computer, so it can be slow or offline.
    static func browserTabs(token: String, teamId: String, sessionId: String) async throws -> [BrowserTab] {
        struct List: Decodable { let tabs: [BrowserTab] }
        let data = try await send("GET", "teams/\(teamId)/browser-tabs/\(sessionId)", token: token, body: Optional<Int>.none, timeout: 20)
        return try JSONDecoder().decode(List.self, from: data).tabs
    }

    /// `POST /teams/:teamId/browser-tabs/:sessionId/:tab/focus`: shows the tab on that computer.
    static func focusBrowserTab(token: String, teamId: String, sessionId: String, tab: String) async throws {
        _ = try await send("POST", "teams/\(teamId)/browser-tabs/\(sessionId)/\(tab)/focus", token: token, body: Optional<Int>.none, timeout: 20)
    }
}
