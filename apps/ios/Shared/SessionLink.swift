import Foundation

/// The canonical web link to a conversation — what desktop's "Copy session
/// URL" puts on the clipboard (`lib/app-routes/producerTeam.ts` builds the
/// path, `ATLAS_WEB_BASE_URL` the origin).
enum SessionLink {
    static let webBase = "https://nuphos.ai"
    /// Where the Live Activity sends a tap outside its rows: the conversation list.
    static let conversations = URL(string: "\(webBase)/agent")!

    /// `https://nuphos.ai/teams/<teamId>/agent/<sessionId>`, with both
    /// segments percent-encoded the way `encodeURIComponent` encodes them.
    static func url(teamId: String, sessionId: String) -> URL? {
        guard !teamId.isEmpty, !sessionId.isEmpty else { return nil }
        return URL(string: "\(webBase)/teams/\(segment(teamId))/agent/\(segment(sessionId))")
    }

    /// The team and session a `url(teamId:sessionId:)` link points at, so a
    /// tap in chat opens it in-app. Like desktop's `parseAtlasLink`, the pages
    /// under `/agent/` are not sessions, and the team must be an ObjectId.
    static func target(in url: URL) -> (teamId: String, sessionId: String)? {
        guard let parts = appPath(of: url), parts.count == 4, parts[0] == "teams", parts[2] == "agent",
              parts[1].wholeMatch(of: #/[0-9a-fA-F]{24}/#) != nil,
              parts[3].wholeMatch(of: #/[A-Za-z0-9_-]+/#) != nil,
              !["memories", "skills", "archived"].contains(parts[3]) else { return nil }
        return (parts[1], parts[3])
    }

    /// The raw path segments of a link to the app's own web origin — exactly
    /// `webBase`, as desktop's `isAppWebUrl` compares it — or of a bare path.
    static func appPath(of url: URL) -> [String]? {
        if url.scheme != nil || url.host() != nil {
            guard url.scheme == "https", url.host()?.lowercased() == "nuphos.ai", url.port == nil else { return nil }
        }
        return url.path().split(separator: "/").map(String.init)
    }

    private static func segment(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathSegmentAllowed) ?? value
    }
}

private extension CharacterSet {
    /// `encodeURIComponent`'s unreserved set: everything else is escaped,
    /// including the `/` and `:` that `.urlPathAllowed` would let through.
    static let urlPathSegmentAllowed = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
    )
}
