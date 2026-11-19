import Foundation

/// An `@` in the composer that picks one of the viewer's other sessions or
/// devices. A session reads as `@Title` and is sent as its link — what desktop
/// sends for the same mention — so the agent can read that conversation; a
/// device becomes `@Label` and is turned on for the session, so the agent may
/// run on it.
enum SessionMention {
    /// The `@query` the draft ends with, or nil. As on desktop, an `@` only
    /// starts a mention at the start of a line or after whitespace, so an
    /// email address being typed never opens the picker.
    static func query(in text: String) -> String? {
        guard let at = text.lastIndex(of: "@") else { return nil }
        let query = text[text.index(after: at)...]
        guard query.count <= 40, !query.contains(where: \.isWhitespace) else { return nil }
        if at > text.startIndex, !text[text.index(before: at)].isWhitespace { return nil }
        return String(query)
    }

    /// The draft with its trailing `@query` replaced by `replacement`.
    static func insert(_ replacement: String, into text: String) -> String {
        guard let at = text.lastIndex(of: "@") else { return text }
        return String(text[..<at]) + replacement + " "
    }

    /// The draft as it is sent: each picked `@Title` becomes the link it stands for.
    static func expand(_ text: String, links: [String: URL]) -> String {
        links.keys.sorted { $0.count > $1.count }.reduce(text) { text, name in
            text.replacingOccurrences(of: name, with: links[name]!.absoluteString)
        }
    }

    /// A message as it reads: a bare link to a conversation the viewer knows
    /// shows as its `@Title`, still a link, as desktop shows it as a chip.
    static func named(_ text: String, title: (String) -> String?) -> String {
        // A link already in markdown, `[label](link)` or `<link>`, keeps its own text.
        text.replacing(#/(^|[^(\[<])(https://nuphos\.ai/teams/[^\s/]+/agent/[A-Za-z0-9_-]+)/#.anchorsMatchLineEndings()) { match in
            let (whole, before, link) = match.output
            guard let url = URL(string: String(link)), let session = SessionLink.target(in: url),
                  let name = title(session.sessionId), !name.isEmpty else { return String(whole) }
            let label = name.replacingOccurrences(of: "[", with: "\\[").replacingOccurrences(of: "]", with: "\\]")
            return "\(before)[@\(label)](\(link))"
        }
    }

    /// Whether a device's label answers the query, as desktop matches it.
    static func matches(_ label: String, _ query: String) -> Bool {
        query.isEmpty || label.localizedCaseInsensitiveContains(query)
    }
}

/// What an `@` in the composer offers: the viewer's devices and other sessions.
struct MentionSource {
    let teamId: String
    var devices: [CredentialCatalog.Item] = []
    /// Turns a mentioned device on for the session.
    var pickDevice: @MainActor (CredentialCatalog.Item) -> Void = { _ in }
    let search: @MainActor (String) async -> [AgentConversation]
}
