import Foundation
import Observation

/// Open questions read from the pending listing, as the desktop's Inbox reads
/// them, and answered from their cards. The Inbox shows them all; a Bot's chat
/// only those under the Bot.
@Observable
final class OpenQuestions {
    let teamId: String
    /// False until the first listing lands.
    private(set) var loaded = false
    private var listed: [BotQuestion] = []
    /// Answered here; hidden until the listing no longer has them open.
    private var answered: Set<String> = []
    private let token: String

    init(token: String, teamId: String) {
        self.token = token
        self.teamId = teamId
    }

    /// What the cards show: the listing, less what was answered here.
    var list: [BotQuestion] { listed.filter { !answered.contains($0.id) } }

    func refresh(pick: ([AgentConversation]) -> [BotQuestion] = BotQuestions.open) async {
        do {
            var rows: [AgentConversation] = []
            var cursor: String?
            // Bounded like the desktop's: a cursor never repeats a page.
            for _ in 0..<10 {
                let page = try await NuphosAPI.conversations(
                    token: token, teamId: teamId, cursor: cursor, limit: 100, pendingDecision: true)
                rows += page.rows
                guard page.hasMore, let next = page.nextCursor, next != cursor else { break }
                cursor = next
            }
            listed = pick(rows)
            answered.formIntersection(listed.map(\.id))
            loaded = true
        } catch {
            // Kept as they were; the next poll tries again.
        }
    }

    /// The owner's own reply to the conversation that asked, naming the question,
    /// so it resolves that one request wherever it is shown. A failed send
    /// shows the question again and throws.
    func answer(_ question: BotQuestion, with text: String) async throws {
        answered.insert(question.id)
        do {
            try await AgentChatAPI.reply(token: token, teamId: teamId, sessionId: question.sessionId,
                                         text: text, decisionReplyTo: question.request.id)
        } catch {
            answered.remove(question.id)
            throw error
        }
    }
}
