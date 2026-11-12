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

    /// The desktop's `formQuestions`: the questions a multi-select or several-question card answers
    /// as a form, sent as one reply; nil for one single-choice question, which keeps its one-tap options.
    var form: [AgentConversation.DecisionQuestion]? {
        guard typed else { return nil }
        if let questions = request.questions, !questions.isEmpty { return questions }
        if request.multiSelect == true, let options = request.options, !options.isEmpty {
            return [.init(question: request.question, options: options, multiSelect: true)]
        }
        return nil
    }

    /// The desktop's `formAnswer`: one question's picks or typed text, or one entry per question.
    static func formAnswer(_ questions: [AgentConversation.DecisionQuestion], picked: [[String]],
                           typed: [String]) -> DecisionAnswer {
        func one(_ index: Int) -> DecisionAnswer {
            let words = typed[index].trimmingCharacters(in: .whitespacesAndNewlines)
            return words.isEmpty ? DecisionAnswer(choices: picked[index]) : DecisionAnswer(text: words)
        }
        return questions.count == 1 ? one(0) : DecisionAnswer(questions: questions.indices.map(one))
    }

    /// The backend's `writtenQuestions`: the questions as markdown after a `---` separator, one line each.
    static func writtenQuestions(_ questions: [AgentConversation.DecisionQuestion]) -> String {
        func line(_ text: String) -> String { text.split(whereSeparator: \.isWhitespace).joined(separator: " ") }
        let list = questions.enumerated().map { index, item in
            (["**\(index + 1). \(line(item.question))**" + (item.multiSelect == true ? " (any number)" : "")]
                + (item.options ?? []).map { "- \(line($0))" }).joined(separator: "\n")
        }
        return "\n\n---\n\n" + list.joined(separator: "\n\n")
    }

    /// The body the agent wrote, without the list the backend writes out after it for clients that
    /// do not render `questions`: dropped only when the body ends with exactly that list, so a `---`
    /// of the agent's own always stays.
    var ownBody: String? {
        guard var body = request.body else { return nil }
        if let questions = request.questions, !questions.isEmpty {
            let written = Self.writtenQuestions(questions)
            if body.hasSuffix(written) { body = String(body.dropLast(written.count)) }
        }
        let own = body.trimmingCharacters(in: .whitespacesAndNewlines)
        return own.isEmpty ? nil : own
    }

    /// One question's answer: what was typed, else the picked options.
    static func answerText(picked: [String], typed: String) -> String {
        let words = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        return words.isEmpty ? picked.joined(separator: ", ") : words
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

/// A person's answer to a question: picked options, typed text, or one per question.
/// The server wakes the agent that asked with it; no message is sent.
struct DecisionAnswer: Equatable, Sendable {
    var choices: [String]? = nil
    var text: String? = nil
    var questions: [DecisionAnswer]? = nil

    var json: JSONValue {
        var body: [String: JSONValue] = [:]
        if let choices { body["choices"] = .array(choices.map(JSONValue.string)) }
        if let text { body["text"] = .string(text) }
        if let questions { body["questions"] = .array(questions.map(\.json)) }
        return .object(body)
    }
}
