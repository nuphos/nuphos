import Foundation

/// A question someone answered, as the transcript shows it to people: who
/// answered what, and the question as it was asked. It is read back from the
/// notice the server wakes the asking agent with (`answerNotice`), whose own
/// text is written for the agent and is never shown.
struct AnsweredQuestion: Equatable, Sendable {
    let name: String
    let question: String
    let answer: String
    var body: String? = nil
    var options: [String] = []
    var asked: Date? = nil
    var answered: Date? = nil

    /// The sender of the notice (`nuphos:decision`).
    static let sender = "nuphos:decision"

    /// The options the answer picked: none when it was typed instead. Several picks arrive joined by ", ".
    var picked: [String] {
        var rest = answer
        var taken = Set<String>()
        // Longest first, so an option that contains another is not half taken.
        for option in options.sorted(by: { $0.count > $1.count }) {
            guard !option.isEmpty, let range = rest.range(of: option) else { continue }
            rest.removeSubrange(range)
            taken.insert(option)
        }
        return rest.replacingOccurrences(of: ", ", with: "").isEmpty ? options.filter(taken.contains) : []
    }

    /// The questions a notice answers, one per question of its card; nil for any other message.
    /// The card, when this conversation asked it, gives the whole body, each question's options
    /// and when it was asked: the notice only excerpts them.
    static func all(_ message: ChatMessage, in messages: [ChatMessage]) -> [AnsweredQuestion]? {
        guard message.metadata?["sender"]?["id"]?.stringValue == sender, message.event != nil,
              let notice = Notice(message.text.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        var card: ChatPart.ToolPart?, asked: Date?
        for candidate in messages where candidate.role == .assistant {
            for case .tool(let tool) in candidate.parts
            where tool.toolName == "request_user_decision" && tool.decisionRequestId == notice.requestId {
                card = tool
                asked = candidate.createdAt
            }
        }
        let questions = (card?.input?["questions"]?.arrayValue ?? []).compactMap { item -> AgentConversation.DecisionQuestion? in
            guard let question = item["question"]?.stringValue else { return nil }
            return .init(question: question, options: item["options"]?.arrayValue?.compactMap(\.stringValue),
                         multiSelect: item["multiSelect"]?.boolValue)
        }
        var body = notice.body
        if let card {
            let request = AgentConversation.InputRequest(
                id: notice.requestId, category: nil, question: notice.question, options: nil, askedAt: nil,
                body: card.input?["body"]?.stringValue, questions: questions)
            body = BotQuestion(sessionId: "", title: "", request: request).ownBody
        }
        let options = card?.input?["options"]?.arrayValue?.compactMap(\.stringValue)
        return notice.answers.enumerated().map { index, entry in
            AnsweredQuestion(
                name: notice.name, question: entry.question, answer: entry.answer, body: body,
                options: (questions.indices.contains(index) ? questions[index].options : nil) ?? options ?? notice.options,
                asked: asked, answered: message.createdAt)
        }
    }

    /// The notice's text, read back into its fields.
    struct Notice: Equatable {
        let requestId: String
        let name: String
        let question: String
        var body: String?
        var options: [String] = []
        var answers: [(question: String, answer: String)] = []

        static func == (a: Notice, b: Notice) -> Bool {
            a.requestId == b.requestId && a.name == b.name && a.question == b.question && a.body == b.body
                && a.options == b.options && a.answers.map(\.question) == b.answers.map(\.question)
                && a.answers.map(\.answer) == b.answers.map(\.answer)
        }

        init?(_ text: String) {
            var lines = text.components(separatedBy: "\n")
            // The asker's context may hold an "Answer:" line of its own; the notice's comes last.
            guard lines.count > 4, let answerAt = lines.lastIndex(of: "Answer:"), answerAt >= 3,
                  let open = lines[0].range(of: "(requestId "), let close = lines[0][open.upperBound...].firstIndex(of: ")"),
                  let name = Self.answeredBy(lines[1]), lines[2].hasPrefix("Question: ") else { return nil }
            requestId = String(lines[0][open.upperBound..<close])
            self.name = name
            // After the answers: the ids the question is about, then what the agent does next.
            var tail = Array(lines[(answerAt + 1)...].dropLast())
            if tail.last?.hasPrefix("About: ") == true { tail.removeLast() }
            lines = Array(lines[2..<answerAt])
            if let last = lines.last, last.hasPrefix("Options: ") {
                options = String(last.dropFirst("Options: ".count)).components(separatedBy: " | ")
                lines.removeLast()
            }
            let contexts = ["Context you gave: ", "Context the asker gave: "]
            let contextAt = lines.firstIndex { line in contexts.contains { line.hasPrefix($0) } }
            question = String(lines[..<(contextAt ?? lines.count)].joined(separator: "\n").dropFirst("Question: ".count))
            if let contextAt, let prefix = contexts.first(where: { lines[contextAt].hasPrefix($0) }) {
                body = String(lines[contextAt...].joined(separator: "\n").dropFirst(prefix.count))
            }
            // "- Which regions? → us, eu"; a typed answer's later lines stay with it.
            let single = "- \(question) → ", whole = tail.joined(separator: "\n")
            if whole.hasPrefix(single) {
                answers = [(question, String(whole.dropFirst(single.count)))]
            } else {
                for line in tail {
                    if line.hasPrefix("- "), let arrow = line.range(of: " → ", options: .backwards) {
                        answers.append((String(line[line.index(line.startIndex, offsetBy: 2)..<arrow.lowerBound]), String(line[arrow.upperBound...])))
                    } else if !answers.isEmpty {
                        answers[answers.count - 1].answer += "\n\(line)"
                    } else {
                        return nil
                    }
                }
            }
            if answers.isEmpty { return nil }
        }

        /// `Answered by: "Sam", this conversation's owner…`: the name is a JSON string.
        private static func answeredBy(_ line: String) -> String? {
            guard line.hasPrefix("Answered by: \"") else { return nil }
            let rest = line.dropFirst("Answered by: ".count)
            var end = rest.index(after: rest.startIndex), escaped = false
            while end < rest.endIndex, escaped || rest[end] != "\"" {
                escaped = !escaped && rest[end] == "\\"
                end = rest.index(after: end)
            }
            guard end < rest.endIndex else { return nil }
            return try? JSONDecoder().decode(String.self, from: Data(rest[...end].utf8))
        }
    }
}
