import Foundation

enum BotQuestionsTests {
    static func run() {
        listsTheBotsQuestionsAtAnyDepth()
        leavesOutOtherBotsAndTeammates()
        decodesTheOpenRequestsOfAListRow()
        theInboxListsEveryOwnQuestionOnce()
        keepsTheBodyTheAgentWroteToDecideFrom()
        aPlanOrASecretIsNeverAnsweredInWords()
        aSecretRequestDrawsTheSecureInputCard()
        aQuestionNamingTheMembersOwnCredentialIsConnectable()
        everyOpenQuestionIsAnsweredOnItsCard()
        aMultiSelectOrSeveralQuestionsAreAForm()
        theInboxGroupsBySourceAndOpensTheNextQuestion()
        aBotsTaskQuestionIsInTheBotsGroup()
        snoozeOffersAnHourTomorrowAndNextMonday()
        aSnoozedQuestionLeavesTheInboxUntilItsTime()
        print("Bot questions passed")
    }

    private static func theInboxGroupsBySourceAndOpensTheNextQuestion() {
        func ask(_ session: String, _ id: String, _ at: String) -> BotQuestion {
            BotQuestion(sessionId: session, title: session, request: .init(id: id, category: "preference", question: id,
                                                                          options: nil, askedAt: at))
        }
        // Oldest first, as the listing gives them.
        let list = [ask("ops", "a", "2026-11-14T09:00:00Z"), ask("bot", "b", "2026-11-14T09:10:00Z"),
                    ask("ops", "c", "2026-11-14T09:20:00Z")]
        let groups = BotQuestions.grouped(list)
        // The source with the newest question first; its questions oldest first.
        precondition(groups.map { $0.map(\.request.id) } == [["a", "c"], ["b"]])
        precondition(BotQuestions.next(after: "ops:a", in: groups) == "ops:c")
        precondition(BotQuestions.next(after: "ops:c", in: groups) == "bot:b")
        // Past the end, back to the first; never the question itself.
        precondition(BotQuestions.next(after: "bot:b", in: groups) == "ops:a")
        precondition(BotQuestions.next(after: "ops:a", in: [[list[0]]]) == nil)
        precondition(list[0].askedDate != nil)
    }

    /// In local time: an hour from now, tomorrow at 9:00 and next Monday at 9:00, once on a Sunday,
    /// when the last two are the same time.
    private static func snoozeOffersAnHourTomorrowAndNextMonday() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Taipei")!
        func at(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
            calendar.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute))!
        }
        // Wednesday afternoon.
        let wednesday = Snooze.times(from: at(18, 14, 30), calendar: calendar)
        precondition(wednesday.map(\.label) == ["1 hour", "Tomorrow, 9:00", "Next Monday, 9:00"])
        precondition(wednesday.map(\.until) == [at(18, 15, 30), at(19, 9), at(23, 9)])
        // Sunday evening: tomorrow is next Monday, offered once.
        let sunday = Snooze.times(from: at(22, 20), calendar: calendar)
        precondition(sunday.map(\.until) == [at(22, 21), at(23, 9)])
        // Monday before 9:00: a week ahead, never today's 9:00.
        precondition(Snooze.times(from: at(23, 8), calendar: calendar).map(\.until) == [at(23, 9), at(24, 9), at(30, 9)])
    }

    /// A question snoozed until a time still to come leaves the Inbox and its count, and is listed
    /// as snoozed, soonest back first; once its time passes it is back.
    private static func aSnoozedQuestionLeavesTheInboxUntilItsTime() {
        func ask(_ id: String, until: String?) -> BotQuestion {
            let json = #"{"id":"\#(id)","category":"preference","question":"\#(id)?","options":["Yes"]"#
                + (until.map { #","snoozedUntil":"\#($0)""# } ?? "") + "}"
            return BotQuestion(sessionId: "s", title: "Agent", request: try! JSONDecoder().decode(
                AgentConversation.InputRequest.self, from: Data(json.utf8)))
        }
        let now = ISO8601DateFormatter().date(from: "2026-11-18T06:00:00Z")!
        let list = [ask("open", until: nil), ask("later", until: "2026-11-23T01:00:00.000Z"),
                    ask("past", until: "2026-11-18T05:00:00.000Z"), ask("soon", until: "2026-11-18T07:00:00Z")]
        precondition(list[1].snoozedDate == ISO8601DateFormatter().date(from: "2026-11-23T01:00:00Z"))
        precondition(BotQuestions.inbox(list, now: now).map(\.request.id) == ["open", "past"])
        precondition(BotQuestions.inbox(list, now: now, snoozed: true).map(\.request.id) == ["soon", "later"])
        // Its time passed: back in the Inbox.
        let later = now.addingTimeInterval(7 * 86_400)
        precondition(BotQuestions.inbox(list, now: later).count == 4)
        precondition(BotQuestions.inbox(list, now: later, snoozed: true).isEmpty)
    }

    /// Tasks lists nothing a Bot dispatched (#2708), so the Inbox files its questions under the Bot,
    /// as Desktop's #2774 does: never a group that reads as a Task the Tasks page does not have.
    private static func aBotsTaskQuestionIsInTheBotsGroup() {
        var bot = row("bot", asks: [("q-bot", "2026-11-09T03:01:00Z")])
        bot.avatar = "07-ada"
        // The pending listing: the rows that ask, then the parents above them up to the Bot.
        let rows = [
            row("canary", parent: "rollout", asks: [("q-canary", "2026-11-09T03:03:00Z")]),
            row("docs", parent: "bot", asks: [("q-docs", "2026-11-09T03:02:00Z")]),
            row("solo", asks: [("q-solo", "2026-11-09T03:04:00Z")]),
            bot,
            row("rollout", parent: "bot"),
        ]
        let groups = BotQuestions.grouped(BotQuestions.open(rows: rows))
        precondition(groups.map { $0.map(\.request.id) } == [["q-solo"], ["q-bot", "q-docs", "q-canary"]])
        precondition(groups[1].map(\.sourceId) == ["bot", "bot", "bot"])
        // Each row still answers, and opens, the Task that asked.
        precondition(groups[1].map(\.sessionId) == ["bot", "docs", "canary"])
        precondition(groups[1][0].bot == nil && groups[1][2].bot?.sessionId == "bot")
        precondition(groups[0][0].bot == nil && groups[0][0].sourceId == "solo")
    }

    private static func aMultiSelectOrSeveralQuestionsAreAForm() {
        func ask(_ request: AgentConversation.InputRequest) -> BotQuestion {
            BotQuestion(sessionId: "s", title: "Agent", request: request)
        }
        let single = ask(.init(id: "a", category: "preference", question: "Ship?", options: ["Yes", "No"], askedAt: nil))
        precondition(single.form == nil)
        var regions = AgentConversation.InputRequest(id: "b", category: "preference", question: "Which regions?",
                                                     options: ["us", "eu"], askedAt: nil)
        regions.multiSelect = true
        precondition(ask(regions).form?.first?.multiSelect == true)
        let data = #"{"id":"c","category":"preference","question":"Rollout","questions":[{"question":"Which regions?","options":["us","eu"],"multiSelect":true},{"question":"Keep the old cluster?","options":["Keep","Delete"]}]}"#
        let several = ask(try! JSONDecoder().decode(AgentConversation.InputRequest.self, from: Data(data.utf8)))
        let form = several.form!
        precondition(form.count == 2)
        precondition(BotQuestion.answerText(picked: ["us", "eu"], typed: " ") == "us, eu")
        precondition(BotQuestion.answerText(picked: ["us"], typed: " Tokyo ") == "Tokyo")
        precondition(BotQuestion.formAnswer(form, picked: [["us", "eu"], []], typed: ["", " Keep "])
            == DecisionAnswer(questions: [DecisionAnswer(choices: ["us", "eu"]), DecisionAnswer(text: "Keep")]))
        precondition(BotQuestion.formAnswer([form[0]], picked: [["us"]], typed: [""]) == DecisionAnswer(choices: ["us"]))
        precondition(DecisionAnswer(choices: ["us"]).json == .object(["choices": .array([.string("us")])]))
        // Only the exact list the backend wrote out is dropped; a `---` of the agent's own stays.
        precondition(BotQuestion.writtenQuestions(form) == "\n\n---\n\n**1. Which regions?** (any number)\n- us\n- eu\n\n**2. Keep the old cluster?**\n- Keep\n- Delete")
        var ruled = AgentConversation.InputRequest(id: "e", category: "preference", question: "Rollout",
                                                   options: nil, askedAt: nil)
        ruled.questions = form
        ruled.body = "Findings.\n\n---\n\nRisks."
        precondition(ask(ruled).ownBody == "Findings.\n\n---\n\nRisks.")
        ruled.body = "Findings.\n\n---\n\nRisks." + BotQuestion.writtenQuestions(form)
        precondition(ask(ruled).ownBody == "Findings.\n\n---\n\nRisks.")
        ruled.body = BotQuestion.writtenQuestions(form)
        precondition(ask(ruled).ownBody == nil)
        var secret = AgentConversation.InputRequest(id: "d", category: "credential", question: "Which key?",
                                                    options: ["a", "b"], askedAt: nil)
        secret.multiSelect = true
        precondition(ask(secret).form == nil)
    }

    private static func row(_ id: String, parent: String? = nil, owner: Bool = true,
                            asks: [(String, String)] = []) -> AgentConversation {
        var row = AgentConversation(sessionId: id, title: id, messageCount: 1, createdAt: .now, lastActiveAt: .now,
                                    isOwner: owner, parentSessionId: parent)
        row.inputRequests = asks.isEmpty ? nil : asks.map {
            .init(id: $0.0, category: "approval", question: "Ship?", options: ["Yes", "No"], askedAt: $0.1)
        }
        return row
    }

    private static func listsTheBotsQuestionsAtAnyDepth() {
        // The pending listing: rows that ask, then every parent above them, which ask nothing.
        let rows = [
            row("canary", parent: "rollout", asks: [("q-canary", "2026-11-09T03:03:00Z")]),
            row("docs", parent: "bot", asks: [("q-docs", "2026-11-09T03:01:00Z")]),
            row("bot", asks: [("q-bot", "2026-11-09T03:02:00Z")]),
            row("rollout", parent: "bot"),
        ]
        let questions = BotQuestions.under(bot: "bot", rows: rows)
        precondition(questions.map(\.request.id) == ["q-docs", "q-bot", "q-canary"])
        precondition(questions.map(\.sessionId) == ["docs", "bot", "canary"])
        precondition(questions[2].link(team: "t1").absoluteString == "https://nuphos.ai/teams/t1/agent/canary")
    }

    private static func leavesOutOtherBotsAndTeammates() {
        let rows = [
            row("elsewhere", parent: "other-bot", asks: [("q-1", "a")]),
            row("theirs", parent: "bot", owner: false, asks: [("q-2", "b")]),
            row("orphan", parent: "unlisted", asks: [("q-3", "c")]),
            // A parent loop never hangs the walk.
            row("loop-a", parent: "loop-b", asks: [("q-4", "d")]), row("loop-b", parent: "loop-a"),
        ]
        precondition(BotQuestions.under(bot: "bot", rows: rows).isEmpty)
    }

    private static func decodesTheOpenRequestsOfAListRow() {
        let json = """
        {"sessionId":"canary","title":"Canary","parentSessionId":"rollout","isOwner":true,
         "inputRequests":[{"id":"q-canary","category":"approval","question":"Ship?","options":["Yes"],
         "askedAt":"2026-11-09T03:03:00Z","status":"open"}]}
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try! decoder.decode(AgentConversation.self, from: Data(json.utf8))
        precondition(decoded.inputRequests?.first?.options == ["Yes"])
        precondition(BotQuestions.under(bot: "rollout", rows: [decoded]).map(\.id) == ["canary:q-canary"])
    }

    private static func theInboxListsEveryOwnQuestionOnce() {
        // A row also listed as another row's parent is read once; a teammate's row is not the viewer's.
        let rows = [
            row("deploy", parent: "bot", asks: [("q-2", "2026-11-09T03:02:00Z"), ("q-1", "2026-11-09T03:01:00Z")]),
            row("bot", asks: [("q-3", "2026-11-09T03:03:00Z")]),
            row("deploy", parent: "bot", asks: [("q-2", "2026-11-09T03:02:00Z")]),
            row("theirs", owner: false, asks: [("q-4", "2026-11-09T03:04:00Z")]),
        ]
        precondition(BotQuestions.open(rows: rows).map(\.request.id) == ["q-1", "q-2", "q-3"])
    }

    private static func keepsTheBodyTheAgentWroteToDecideFrom() {
        let decoder = JSONDecoder()
        let withBody = #"{"id":"q","question":"Direction OK?","body":"**Why:** see [#412](https://example.com/412)"}"#
        let request = try! decoder.decode(AgentConversation.InputRequest.self, from: Data(withBody.utf8))
        precondition(request.body == "**Why:** see [#412](https://example.com/412)")
        let plain = try! decoder.decode(AgentConversation.InputRequest.self, from: Data(#"{"id":"q","question":"Ship?"}"#.utf8))
        precondition(plain.body == nil)
        // Up to four short lines show whole; more collapses behind "Show more".
        precondition(!BotQuestion.isLongBody("One finding.\nA second.\nA third.\nA fourth."))
        precondition(BotQuestion.isLongBody("1\n2\n3\n4\n5"))
        precondition(BotQuestion.isLongBody(String(repeating: "x", count: 241)))
    }

    /// The listing names the secret, so a Bot's chat asks for it as the task does.
    private static func aSecretRequestDrawsTheSecureInputCard() {
        func ask(_ json: String) -> BotQuestion {
            BotQuestion(sessionId: "s", title: "Agent", request: try! JSONDecoder().decode(
                AgentConversation.InputRequest.self, from: Data(json.utf8)))
        }
        let part = ask(#"{"id":"r","category":"credential","question":"The API needs a key.","secretName":"API_KEY"}"#).secretPart
        precondition(part?.secretRequest?.name == "API_KEY")
        precondition(part?.secretRequest?.reason == "The API needs a key.")
        // Its request is the one the card closes once the value is saved.
        precondition(part?.decisionRequestId == "r")
        precondition(ask(#"{"id":"r","category":"credential","question":"Sign in."}"#).secretPart == nil)
        precondition(ask(#"{"id":"r","category":"credential","question":"Key?","secretName":"not a name"}"#).secretPart == nil)
    }

    private static func aPlanOrASecretIsNeverAnsweredInWords() {
        func ask(_ category: String, planId: String? = nil) -> BotQuestion {
            BotQuestion(sessionId: "s", title: "Agent", request: .init(
                id: "r", category: category, question: "Go?", options: ["Approve", "Reject"], askedAt: nil, planId: planId))
        }
        precondition(ask("preference").typed)
        precondition(!ask("approval", planId: "p1").typed)
        precondition(!ask("credential").typed)
        // An integration question naming nothing to select, e.g. a service with no connector, takes words.
        precondition(ask("integration").typed)
        let plan = try! JSONDecoder().decode(
            AgentConversation.InputRequest.self, from: Data(#"{"id":"r","question":"Approve?","planId":"p1"}"#.utf8))
        precondition(plan.planId == "p1")
    }

    /// No open question is left without a way to answer it on its card: options or words beside Snooze and Dismiss,
    /// a form, a secure card or a picker, never "answer it elsewhere".
    private static func everyOpenQuestionIsAnsweredOnItsCard() {
        func ask(_ json: String) -> BotQuestion {
            BotQuestion(sessionId: "s", title: "Agent", request: try! JSONDecoder().decode(
                AgentConversation.InputRequest.self, from: Data(json.utf8)))
        }
        // A sign-in status card: a credential with options and no secret is answered with them.
        let signedIn = ask(#"{"id":"q","category":"credential","question":"Sign in?","options":["Signed in","Not now"]}"#)
        precondition(signedIn.options == ["Signed in", "Not now"] && !signedIn.typed)
        // An integration naming no provider keeps its options and its words.
        let play = ask(#"{"id":"q","category":"integration","question":"Play review?","options":["I check","Wait"]}"#)
        precondition(play.options == ["I check", "Wait"] && play.typed)
        // A question with a markdown body and no options is answered in words.
        let repo = ask(#"{"id":"q","category":"preference","question":"Which repo?","body":"**Done**: `x`\n1. repo"}"#)
        precondition(repo.options == [] && repo.typed && repo.ownBody != nil)
        let plan = ask(#"{"id":"q","category":"approval","question":"Ship?","options":["Approve","Reject"],"planId":"p"}"#)
        precondition(plan.options == ["Approve", "Reject"])
        for question in [signedIn, play, repo, plan,
                         ask(#"{"id":"q","category":"credential","question":"Key?","secretName":"API_KEY"}"#),
                         ask(#"{"id":"q","category":"integration","question":"GCP?","providers":["gcp"]}"#),
                         ask(#"{"id":"q","category":"preference","question":"?","questions":[{"question":"A?","options":["1","2"],"multiSelect":true}]}"#)] {
            precondition(!question.request.question.isEmpty)
            precondition(question.options != nil || question.form != nil || question.secretPart != nil || question.connectable,
                         "\(question.request.category ?? "") has no way to be answered on its card")
        }
    }

    private static func aQuestionNamingTheMembersOwnCredentialIsConnectable() {
        func ask(_ json: String) -> BotQuestion {
            BotQuestion(sessionId: "s", title: "Agent", request: try! JSONDecoder().decode(
                AgentConversation.InputRequest.self, from: Data(json.utf8)))
        }
        let own = ask(#"{"id":"q","category":"integration","question":"?","credentials":[{"provider":"personal","id":"github"}]}"#)
        precondition(own.personalCredentials == ["github"] && own.connectable)
        precondition(ask(#"{"id":"q","category":"integration","question":"?","providers":["github"]}"#).connectable)
        // A mix of providers and credentials, or a team credential named, gets no card in the Inbox.
        precondition(!ask(#"{"id":"q","category":"integration","question":"?","providers":["github"],"credentials":[{"provider":"personal","id":"github"}]}"#).connectable)
        precondition(!ask(#"{"id":"q","category":"integration","question":"?","credentials":[{"provider":"github","id":"166"}]}"#).connectable)
        // Naming no provider, it is answered in words, never by a picker no selection can answer it from.
        let unnamed = ask(#"{"id":"q","category":"integration","question":"Play Console?"}"#)
        precondition(!unnamed.connectable && unnamed.typed)
        precondition(!ask(#"{"id":"q","category":"integration","question":"?","providers":[]}"#).connectable)
        precondition(!ask(#"{"id":"q","category":"integration","question":"?","providers":["github"]}"#).typed)
    }
}
