import Foundation

/// An `@` in the composer that picks one of the viewer's other sessions or
/// devices. A session becomes its link — what desktop sends for the same
/// mention — so the agent can read that conversation; a device becomes
/// `@Label` and is turned on for the session, so the agent may run on it.
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
