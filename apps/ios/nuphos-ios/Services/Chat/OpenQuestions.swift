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

    /// The asking conversation's credential selection, for an integration card to add to;
    /// nil, with why on its card, if it could not be read.
    func storedSelection(for question: BotQuestion) async -> CredentialSelection? {
        failures[question.id] = nil
        do {
            let detail = try await NuphosAPI.conversationDetail(token: token, teamId: teamId, sessionId: question.sessionId, tail: 1)
            return detail.credentialAccess.map(CredentialSelection.init(json:)) ?? CredentialSelection()
        } catch {
            failures[question.id] = error.localizedDescription
            return nil
        }
    }

    /// Saves the asking conversation's selection, as its credential picker would. The server
    /// answers the question once it covers a provider asked for; the card leaves with the listing.
    /// Answers a question naming the member's own credentials: adds them to the asking conversation's
    /// stored selection, nothing else. One not connected (`connected` is the member's own) is said on the card.
    func useOwn(_ ids: [String], for question: BotQuestion, connected: Set<String>) async {
        guard ids.allSatisfy(connected.contains) else {
            failures[question.id] = String(localized: "Connect it in Settings → Personal Credentials first.")
            return
        }
        guard var selection = await storedSelection(for: question) else { return }
        selection.ids["personalCredentialIds", default: []].formUnion(ids)
        await select(selection, for: question)
    }

    func select(_ selection: CredentialSelection, for question: BotQuestion) async {
        failures[question.id] = nil
        do {
            try await AgentChatAPI.updateCredentials(token: token, teamId: teamId, sessionId: question.sessionId, selection: selection)
        } catch {
            failures[question.id] = error.localizedDescription
        }
        await refresh()
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
