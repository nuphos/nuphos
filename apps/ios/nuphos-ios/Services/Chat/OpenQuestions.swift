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

    init(token: String, teamId: String) {
        self.token = token
        self.teamId = teamId
    }

    /// What the Inbox lists: the listing, less what was answered here.
    var list: [BotQuestion] { listed.filter { !answered.contains($0.id) } }

    /// The question open beside the list, or pushed over it on iPhone.
    var selected: String?
    /// The Inbox's last answer, not sent yet so it can be undone.
    private var held: (token: UUID, question: BotQuestion, answer: DecisionAnswer)?
    /// What that answer says, for the "Answered …" toast while it can be undone: the options
    /// chosen or the words, else (a form) the question.
    var toast: String? {
        guard let held else { return nil }
        return held.answer.choices?.joined(separator: ", ") ?? held.answer.text ?? held.question.request.question
    }

    /// The list by the conversation that asked.
    var groups: [[BotQuestion]] { BotQuestions.grouped(list) }

    /// The question to open after `id`.
    func next(after id: String) -> String? { BotQuestions.next(after: id, in: groups) }

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
            // A Bot's group wears its face, even before the Bot list loads.
            await MainActor.run { BotFaces.shared.learn(rows) }
            listed = pick(rows)
            answered.formIntersection(listed.map(\.id))
            // Answered elsewhere: nothing stays open on it.
            if let selected, !list.contains(where: { $0.id == selected }) { self.selected = nil }
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
            // None stored is still stored: nothing it leaves unset is sent as empty.
            return CredentialSelection(json: detail.credentialAccess ?? .object([:]))
        } catch {
            failures[question.id] = error.localizedDescription
            return nil
        }
    }

    /// Answers a question naming the member's own credentials: adds them to the asking conversation's
    /// stored selection, nothing else. `connected` is the member's own, nil when they could not be read;
    /// either way short of all of them is said on the card.
    func useOwn(_ ids: [String], for question: BotQuestion, connected: Set<String>?) async {
        guard let connected else {
            failures[question.id] = String(localized: "Couldn't load your credentials. Try again.")
            return
        }
        guard ids.allSatisfy(connected.contains) else {
            failures[question.id] = String(localized: "Connect it in Settings → Personal Credentials first.")
            return
        }
        guard var selection = await storedSelection(for: question) else { return }
        selection.ids["personalCredentialIds", default: []].formUnion(ids)
        await select(selection, for: question)
    }

    /// Saves the asking conversation's selection, as its credential picker would. The server
    /// answers the question once it covers a provider asked for; the card leaves with the listing.
    func select(_ selection: CredentialSelection, for question: BotQuestion) async {
        failures[question.id] = nil
        do {
            try await AgentChatAPI.updateCredentials(token: token, teamId: teamId, sessionId: question.sessionId, selection: selection)
        } catch {
            failures[question.id] = error.localizedDescription
        }
        await refresh()
    }

    /// Answers a question: the server wakes the agent that asked with the answer, and no
    /// message is sent. Hidden at once; if the answer is refused, the question comes back with why.
    func answer(_ question: BotQuestion, with answer: DecisionAnswer) async {
        answered.insert(question.id)
        failures[question.id] = nil
        do {
            _ = try await AgentChatAPI.send(
                "POST", "agent/conversations/\(question.sessionId)/decisions/\(question.request.id)/answer",
                query: [URLQueryItem(name: "teamId", value: teamId)], token: token, body: answer.json)
        } catch {
            answered.remove(question.id)
            failures[question.id] = error.localizedDescription
            // Back to it, with why, unless another question is open by now.
            if selected == nil { selected = question.id }
        }
    }

    /// The Inbox's answer: the question leaves and the next one opens at once, but the answer is
    /// sent only after five seconds, so Undo can take it back. The one held before goes now.
    func hold(_ question: BotQuestion, with answer: DecisionAnswer) async {
        await sendHeld()
        if selected == question.id { selected = next(after: question.id) }
        answered.insert(question.id)
        failures[question.id] = nil
        let token = UUID()
        held = (token, question, answer)
        Task {
            try? await Task.sleep(for: .seconds(5))
            if held?.token == token { await sendHeld() }
        }
    }

    /// Takes the held answer back: nothing is sent, and its question is open again.
    func undo() {
        guard let held else { return }
        self.held = nil
        answered.remove(held.question.id)
        selected = held.question.id
    }

    /// Sends the held answer now: when the five seconds are up, or the Inbox is left.
    func sendHeld() async {
        guard let held else { return }
        self.held = nil
        await answer(held.question, with: held.answer)
    }
}
