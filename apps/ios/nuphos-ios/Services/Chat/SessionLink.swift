import Foundation

/// The canonical web link to a conversation — what desktop's "Copy session
/// URL" puts on the clipboard (`lib/app-routes/producerTeam.ts` builds the
/// path, `ATLAS_WEB_BASE_URL` the origin).
enum SessionLink {
    static let webBase = "https://nuphos.ai"

    /// `https://nuphos.ai/teams/<teamId>/agent/<sessionId>`, with both
    /// segments percent-encoded the way `encodeURIComponent` encodes them.
    static func url(teamId: String, sessionId: String) -> URL? {
        guard !teamId.isEmpty, !sessionId.isEmpty else { return nil }
        return URL(string: "\(webBase)/teams/\(segment(teamId))/agent/\(segment(sessionId))")
    }

    /// The team and session a `url(teamId:sessionId:)` link points at — any
    /// nuphos.ai host, or the bare path — so a tap in chat opens it in-app.
    static func target(in url: URL) -> (teamId: String, sessionId: String)? {
        guard let parts = appPath(of: url), parts.count >= 4, parts[0] == "teams", parts[2] == "agent",
              !parts[1].isEmpty, !parts[3].isEmpty else { return nil }
        return (parts[1], parts[3])
    }

    /// The decoded path segments of a link to the app's own web origin.
    static func appPath(of url: URL) -> [String]? {
        if let host = url.host()?.lowercased() {
            guard host == "nuphos.ai" || host.hasSuffix(".nuphos.ai") else { return nil }
        } else if url.scheme != nil {
            return nil
        }
        return url.path().split(separator: "/").map { $0.removingPercentEncoding ?? String($0) }
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
