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

    /// The conversation's whole dock: every tab, the one in front, and the Mac's New Tab history.
    /// A backend from before the mirrored dock answers only browser tabs; they read as a dock.
    static func dock(token: String, teamId: String, sessionId: String) async throws -> DockState {
        struct Response: Decodable { let tabs: [BrowserTab]; let dock: DockState? }
        let data = try await send("GET", "teams/\(teamId)/browser-tabs/\(sessionId)", token: token, body: Optional<Int>.none, timeout: 20)
        let response = try JSONDecoder().decode(Response.self, from: data)
        return response.dock ?? DockState(
            tabs: response.tabs.map { DockTab(id: $0.id, kind: "team.browser", title: $0.title, href: "", url: $0.url) },
            activeTabId: nil, recent: []
        )
    }

    /// `DELETE /teams/:teamId/browser-tabs/:sessionId/:tab`: closes the tab in the Mac's dock.
    static func closeDockTab(token: String, teamId: String, sessionId: String, tab: String) async throws {
        _ = try await send("DELETE", "teams/\(teamId)/browser-tabs/\(sessionId)/\(tab)", token: token, body: Optional<Int>.none, timeout: 20)
    }

    /// `POST /teams/:teamId/browser-tabs/:sessionId`: opens a page in the Mac's dock, by its app
    /// path or its workspace page key. Answers the new tab's id.
    static func openDockTab(token: String, teamId: String, sessionId: String, href: String?, page: String?) async throws -> String {
        struct Body: Encodable { var href: String?; var page: String? }
        struct Opened: Decodable { let id: String }
        let data = try await send("POST", "teams/\(teamId)/browser-tabs/\(sessionId)", token: token, body: Body(href: href, page: page), timeout: 20)
        return try JSONDecoder().decode(Opened.self, from: data).id
    }

    /// `POST /teams/:teamId/browser-tabs/:sessionId/fetch`: one request of a page on the owner's
    /// Mac or its network, fetched there.
    static func dockFetch(token: String, teamId: String, sessionId: String, request: DockFetchRequest) async throws -> DockFetchResponse {
        let data = try await send("POST", "teams/\(teamId)/browser-tabs/\(sessionId)/fetch", token: token, body: request, timeout: 25)
        return try JSONDecoder().decode(DockFetchResponse.self, from: data)
    }

    /// `POST /teams/:teamId/browser-tabs/:sessionId/:tab/focus`: shows the tab on that computer.
    static func focusBrowserTab(token: String, teamId: String, sessionId: String, tab: String) async throws {
        _ = try await send("POST", "teams/\(teamId)/browser-tabs/\(sessionId)/\(tab)/focus", token: token, body: Optional<Int>.none, timeout: 20)
    }
}
