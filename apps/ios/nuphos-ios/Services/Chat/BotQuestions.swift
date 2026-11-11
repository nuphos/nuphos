import Foundation

/// An open question a Bot's chat shows: one request and the conversation that asked it.
struct BotQuestion: Identifiable, Equatable, Sendable {
    /// A question body of more than about three lines: its card shows it collapsed until asked for.
    static func isLongBody(_ text: String) -> Bool {
        text.split(separator: "\n", omittingEmptySubsequences: false).count > 3 || text.count > 240
    }

    let sessionId: String
    let title: String
    let request: AgentConversation.InputRequest

    var id: String { "\(sessionId):\(request.id)" }

    /// Answered in words, "Other…": never a plan, approved or rejected, nor a credential or connection.
    var typed: Bool {
        !["credential", "integration"].contains(request.category) && request.planId == nil
    }

    /// The member's own credentials an integration question names, answered only by adding them to
    /// `personalCredentialIds`; nil unless every named credential is personal and no providers are mixed in.
    var personalCredentials: [String]? {
        guard request.providers == nil, let refs = request.credentials, !refs.isEmpty,
              refs.allSatisfy({ $0.provider == "personal" }) else { return nil }
        return refs.map(\.id)
    }

    /// An integration question the Inbox answers in place: by its providers, or by the member's own credentials.
    var connectable: Bool {
        request.category == "integration" && (request.credentials == nil || personalCredentials != nil)
    }

    /// The question quoted above a composer whose next message answers it.
    var quote: ChannelReply { ChannelReply(id: nil, authorName: title, text: request.question) }
}

/// The open questions in the pending listing, whose rows come with every
/// parent above them: all of them for the Inbox, or, as the desktop's
/// `sessionInputRequests` for a Bot's chat (#1848), those of the Bot and of
/// every conversation under it, at any depth.
enum BotQuestions {
    /// The viewer's own questions under `bot`, oldest first.
    static func under(bot: String, rows: [AgentConversation]) -> [BotQuestion] {
        let parent = Dictionary(rows.map { ($0.sessionId, $0.parentSessionId) }, uniquingKeysWith: { first, _ in first })
        func isUnder(_ sessionId: String) -> Bool {
            var current: String? = sessionId
            var seen = Set<String>()
            while let id = current, seen.insert(id).inserted {
                if id == bot { return true }
                current = parent[id] ?? nil
            }
            return false
        }
        return open(rows: rows.filter { isUnder($0.sessionId) })
    }

    /// The viewer's own open questions in `rows`, oldest first: the Inbox's list.
    static func open(rows: [AgentConversation]) -> [BotQuestion] {
        var listed = Set<String>()
        return rows
            .filter { $0.isOwner == true && listed.insert($0.sessionId).inserted }
            .flatMap { row in
                (row.inputRequests ?? []).map { BotQuestion(sessionId: row.sessionId, title: row.displayTitle, request: $0) }
            }
            .sorted { ($0.request.askedAt ?? "", $0.id) < ($1.request.askedAt ?? "", $1.id) }
    }
}

extension BotQuestion {
    /// The conversation that asked, opened in the app like any Nuphos link.
    func link(team: String) -> URL {
        URL(string: "https://nuphos.ai/teams/\(team)/agent/\(sessionId)")!
    }
}
