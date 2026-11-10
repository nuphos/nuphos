import Foundation

/// An open question a Bot's chat shows: one request and the conversation that asked it.
struct BotQuestion: Identifiable, Equatable, Sendable {
    let sessionId: String
    let title: String
    let request: AgentConversation.InputRequest

    var id: String { "\(sessionId):\(request.id)" }
}

/// The desktop's `sessionInputRequests` for a Bot's chat (#1848): the open
/// questions of the Bot and of every conversation under it, at any depth,
/// from the pending listing, whose rows come with every parent above them.
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
        var listed = Set<String>()
        return rows
            .filter { $0.isOwner == true && listed.insert($0.sessionId).inserted && isUnder($0.sessionId) }
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
