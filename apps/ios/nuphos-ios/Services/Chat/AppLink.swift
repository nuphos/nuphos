import Foundation

/// A nuphos.ai page the app shows itself. Links tapped in a chat and links
/// that open the app both go through here, so the two agree on what opens
/// in-app and what leaves for Safari.
enum AppLink: Equatable {
    case session(teamId: String, sessionId: String)
    case plan(PlanLink.Target)

    /// The page `url` points at: a nuphos.ai URL, a bare path, or the
    /// `nuphos://open?url=<page>` hand-off nuphos.ai uses to open the app.
    /// Nil for pages the app has no screen for.
    init?(_ url: URL) {
        let page = Self.unwrapped(url)
        if let link = SessionLink.target(in: page) {
            self = .session(teamId: link.teamId, sessionId: link.sessionId)
        } else if let plan = PlanLink.target(in: page) {
            self = .plan(plan)
        } else {
            return nil
        }
    }

    /// The page inside a `nuphos://open` link; any other URL as it is. The
    /// page still has to pass the exact-origin checks of the targets above.
    private static func unwrapped(_ url: URL) -> URL {
        guard url.scheme == "nuphos", url.host() == "open",
              let page = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "url" })?.value
                .flatMap(URL.init(string:)),
              page.scheme != "nuphos" else { return url }
        return page
    }
}
