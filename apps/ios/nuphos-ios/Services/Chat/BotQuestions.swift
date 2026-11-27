import Foundation

/// An open question a Bot's chat shows: one request and the conversation that asked it.
struct BotQuestion: Identifiable, Equatable, Sendable {
    /// A question body of more than about four lines: its card shows it collapsed until asked for.
    static func isLongBody(_ text: String) -> Bool {
        text.split(separator: "\n", omittingEmptySubsequences: false).count > 4 || text.count > 240
    }

    let sessionId: String
    let title: String
    let request: AgentConversation.InputRequest
    /// The asking conversation's runtime: its mark when it is a Task, its badge when a Bot.
    var runtime: String? = nil
    /// The Bot a Task works under, at any depth: the Inbox lists the question in the Bot's group,
    /// as Tasks lists no such Task (#2774).
    var bot: AgentConversation? = nil

    var id: String { "\(sessionId):\(request.id)" }

    /// Answered in words, "Other…": never a plan, approved or rejected, nor a connection.
    /// An integration question naming nothing to select, e.g. a service Nuphos cannot connect, takes words.
    /// A credential takes words only beside its options, never as its value (#4029).
    var typed: Bool {
        guard request.planId == nil, !connectable else { return false }
        return request.category != "credential" || (request.secretName == nil && !(request.options ?? []).isEmpty)
    }

    /// A secret request as its tool call carries it in the transcript, so the secure input card
    /// draws from the listing too; nil unless the question names a secret.
    var secretPart: ChatPart.ToolPart? {
        guard let name = request.secretName else { return nil }
        var input: [String: JSONValue] = ["category": .string(request.category ?? ""), "question": .string(request.question),
                                          "secretName": .string(name)]
        if let fields = request.fields, let site = request.site {
            input["fields"] = .array(fields.map { .object(["name": .string($0.name), "label": .string($0.label)]) })
            input["site"] = .string(site)
        }
        let part = ChatPart.ToolPart(
            toolCallId: request.id, toolName: "request_user_decision", isDynamic: true, state: .inputAvailable,
            input: .object(input))
        return part.secretRequest == nil ? nil : part
    }

    /// The member's own credentials an integration question names, answered only by adding them to
    /// `personalCredentialIds`; nil unless every named credential is personal and no providers are mixed in.
    var personalCredentials: [String]? {
        guard request.providers == nil, let refs = request.credentials, !refs.isEmpty,
              refs.allSatisfy({ $0.provider == "personal" }) else { return nil }
        return refs.map(\.id)
    }

    /// The one-tap answers, possibly none, beside Dismiss; nil for a form, a secret or a connection,
    /// each answered in its own way. Every other open question is answered here, never elsewhere.
    var options: [String]? {
        guard form == nil, secretPart == nil, !connectable else { return nil }
        return (request.options ?? []).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    /// An integration question the Inbox answers in place: by its providers, or by the member's own credentials.
    var connectable: Bool {
        request.category == "integration"
            && (personalCredentials != nil || (request.credentials == nil && !(request.providers ?? []).isEmpty))
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

    /// The questions a choice card answers, single- or multi-select alike, as `QuestionOptions`
    /// draws them; nil for a secret, a connect question or a plan without options.
    var choices: [AgentConversation.DecisionQuestion]? {
        form ?? options.map { [.init(question: request.question, options: $0, multiSelect: false)] }
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

    /// The Inbox group it is in: its Bot's, else the conversation that asked.
    var sourceId: String { bot?.sessionId ?? sessionId }
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
        return open(rows: rows.filter { isUnder($0.sessionId) }, includeOnboarding: true)
    }

    /// The Inbox's list by its Bot, else the conversation that asked: the group with the newest question first,
    /// each group's questions oldest first, as `open` lists them.
    static func grouped(_ list: [BotQuestion]) -> [[BotQuestion]] {
        Dictionary(grouping: list, by: \.sourceId).values
            .sorted { ($0.last?.request.askedAt ?? "", $0[0].sourceId) > ($1.last?.request.askedAt ?? "", $1[0].sourceId) }
    }

    /// The question to open after `id`: the one listed after it, else the first other one.
    static func next(after id: String, in groups: [[BotQuestion]]) -> String? {
        let ids = groups.joined().map(\.id)
        guard let index = ids.firstIndex(of: id) else { return ids.first }
        return (ids[(index + 1)...] + ids[..<index]).first
    }

    /// The Inbox's questions at `now`: those not snoozed past it; with `snoozed`, only those, soonest back first.
    static func inbox(_ list: [BotQuestion], now: Date, snoozed: Bool = false) -> [BotQuestion] {
        let picked = list.filter { ($0.snoozedDate.map { $0 > now } ?? false) == snoozed }
        return snoozed ? picked.sorted { $0.snoozedDate! < $1.snoozedDate! } : picked
    }

    /// The viewer's own open questions in `rows`, oldest first: the Inbox's list.
    static func open(rows: [AgentConversation]) -> [BotQuestion] {
        open(rows: rows, includeOnboarding: false)
    }

    private static func open(rows: [AgentConversation], includeOnboarding: Bool) -> [BotQuestion] {
        var listed = Set<String>()
        let owners = ConversationNesting.botOwners(rows)
        let byId = Dictionary(rows.map { ($0.sessionId, $0) }, uniquingKeysWith: { first, _ in first })
        return rows
            .filter { $0.isOwner == true && listed.insert($0.sessionId).inserted }
            .flatMap { row in
                (row.inputRequests ?? []).filter { includeOnboarding || !["pending", "active"].contains(row.botOnboarding ?? "") || $0.category != "preference" }.map { BotQuestion(sessionId: row.sessionId, title: row.displayTitle, request: $0, runtime: row.agentRuntime,
                                                     bot: owners[row.sessionId].flatMap { byId[$0] }) }
            }
            .sorted { ($0.request.askedAt ?? "", $0.id) < ($1.request.askedAt ?? "", $1.id) }
    }
}

extension BotQuestion {
    /// When it was asked, if the listing said.
    var askedDate: Date? { Self.date(request.askedAt) }

    /// When its owner snoozed it until, if they did.
    var snoozedDate: Date? { Self.date(request.snoozedUntil) }

    private static func date(_ raw: String?) -> Date? {
        guard let raw else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return iso.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
    }

    /// The conversation that asked, opened in the app like any Nuphos link.
    func link(team: String) -> URL {
        URL(string: "https://nuphos.ai/teams/\(team)/agent/\(sessionId)")!
    }
}

/// A card's answers so far, per question: its picked options, whether "Other" is picked, and its
/// words. "Other" is one more option, never sent with the others; its words answer the question.
struct QuestionForm: Equatable {
    let questions: [AgentConversation.DecisionQuestion]
    var picked: [[String]]
    var other: [Bool]
    var words: [String]

    /// `typed`, a form question with nothing to pick is answered in words from the start; a one-tap
    /// question opens its words with "Reply…".
    init(_ questions: [AgentConversation.DecisionQuestion], typed: Bool) {
        self.questions = questions
        picked = questions.map { _ in [] }
        let form = !Self.instant(questions)
        other = questions.map { form && typed && ($0.options ?? []).isEmpty }
        words = questions.map { _ in "" }
    }

    /// One question with one answer: a tap answers it, and there is nothing to send.
    var instant: Bool { Self.instant(questions) }

    private static func instant(_ questions: [AgentConversation.DecisionQuestion]) -> Bool {
        questions.count == 1 && questions[0].multiSelect != true
    }

    func answered(_ index: Int) -> Bool {
        other[index] ? !words[index].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty : !picked[index].isEmpty
    }

    /// How many questions are still unanswered.
    var left: Int { questions.indices.filter { !answered($0) }.count }

    mutating func pick(_ option: String, at index: Int) {
        other[index] = false
        if picked[index].contains(option) {
            picked[index].removeAll { $0 == option }
        } else {
            picked[index] = questions[index].multiSelect == true ? picked[index] + [option] : [option]
        }
    }

    mutating func pickOther(at index: Int) {
        other[index].toggle()
        if other[index] { picked[index] = [] }
    }

    /// One question's picks or words, or one entry per question.
    var answer: DecisionAnswer {
        func one(_ index: Int) -> DecisionAnswer {
            other[index] ? DecisionAnswer(text: words[index].trimmingCharacters(in: .whitespacesAndNewlines))
                : DecisionAnswer(choices: picked[index])
        }
        return questions.count == 1 ? one(0) : DecisionAnswer(questions: questions.indices.map(one))
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

/// When an Inbox question can be snoozed until, as on Desktop: an hour from now, tomorrow at 9:00
/// and next Monday at 9:00, in local time. On a Sunday those last two are one, offered once.
enum Snooze {
    struct Time: Hashable {
        let label: String
        let until: Date
    }

    static func times(from now: Date, calendar: Calendar = .current) -> [Time] {
        let today = calendar.startOfDay(for: now)
        func at9(_ days: Int) -> Date {
            calendar.date(bySettingHour: 9, minute: 0, second: 0, of: calendar.date(byAdding: .day, value: days, to: today)!)!
        }
        // Weekday 1 is Sunday: Monday is a day ahead of it, and a week ahead of a Monday.
        let ahead = (9 - calendar.component(.weekday, from: now)) % 7
        let tomorrow = at9(1), monday = at9(ahead == 0 ? 7 : ahead)
        return [Time(label: String(localized: "1 hour"), until: now.addingTimeInterval(3_600)),
                Time(label: String(localized: "Tomorrow, 9:00"), until: tomorrow)]
            + (monday == tomorrow ? [] : [Time(label: String(localized: "Next Monday, 9:00"), until: monday)])
    }

    /// The most a dismissal's reason may hold: the server refuses a longer one.
    static let reasonLimit = 1_000

    /// A dismissal's reason as it is sent: trimmed, within the limit, and nil when left empty.
    static func reason(_ text: String) -> String? {
        let trimmed = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(reasonLimit))
        return trimmed.isEmpty ? nil : trimmed
    }

    /// When a snoozed question comes back: its time today, else its weekday and time.
    static func returnTime(_ date: Date, now: Date = .now) -> String {
        Calendar.current.isDate(date, inSameDayAs: now)
            ? date.formatted(.dateTime.hour().minute())
            : date.formatted(.dateTime.weekday(.abbreviated).hour().minute())
    }
}
