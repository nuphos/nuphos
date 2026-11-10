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
    /// Why the last answer to a question failed, by `BotQuestion.id`, until it is answered again.
    private(set) var failures: [String: String] = [:]
    private let token: String
    /// A Bot's own chat, if it has one: a Bot's own question is answered there, where it shows.
    private let chatOf: (String) -> String?

    init(token: String, teamId: String, chatOf: @escaping (String) -> String? = { _ in nil }) {
        self.token = token
        self.teamId = teamId
        self.chatOf = chatOf
    }

    /// What the cards show: the listing, less what was answered here.
    var list: [BotQuestion] { listed.filter { !answered.contains($0.id) } }

    func refresh(pick: @MainActor ([AgentConversation]) -> [BotQuestion] = BotQuestions.open) async {
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
    /// so it resolves that one request wherever it is shown: a card's quick reply.
    /// Hidden at once; if it could not be sent, the card comes back with why.
    /// `send` is how the answer goes out, when not as that reply.
    func answer(_ question: BotQuestion, with text: String, send: (() async throws -> Void)? = nil) async {
        answered.insert(question.id)
        failures[question.id] = nil
        do {
            if let send {
                try await send()
            } else if let chat = chatOf(question.sessionId) {
                try await ChannelSession.postAnswer(token: token, teamId: teamId, channelId: chat, text: text,
                                                    id: UUID().uuidString.lowercased(), to: question.request.id)
            } else {
                try await AgentChatAPI.reply(token: token, teamId: teamId, sessionId: question.sessionId,
                                             text: text, decisionReplyTo: question.request.id)
            }
        } catch {
            answered.remove(question.id)
            failures[question.id] = error.localizedDescription
        }
    }
}
