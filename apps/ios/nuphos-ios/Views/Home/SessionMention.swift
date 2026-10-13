import Foundation

/// An `@` in the composer that picks one of the viewer's other sessions. The
/// pick becomes the session's link — what desktop sends for the same mention —
/// so the agent can read that conversation.
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

    /// The draft with its trailing `@query` replaced by `link`.
    static func insert(_ link: URL, into text: String) -> String {
        guard let at = text.lastIndex(of: "@") else { return text }
        return String(text[..<at]) + link.absoluteString + " "
    }
}

/// Where the composer looks up the viewer's other sessions for an `@`.
struct SessionMentionSource {
    let teamId: String
    let search: @MainActor (String) async -> [AgentConversation]
}
