import Foundation

enum BotQuestionsTests {
    static func run() {
        listsTheBotsQuestionsAtAnyDepth()
        leavesOutOtherBotsAndTeammates()
        decodesTheOpenRequestsOfAListRow()
        theInboxListsEveryOwnQuestionOnce()
        keepsTheBodyTheAgentWroteToDecideFrom()
        aPlanOrASecretIsNeverAnsweredInWords()
        aQuestionNamingTheMembersOwnCredentialIsConnectable()
        aMultiSelectOrSeveralQuestionsAreAForm()
        print("Bot questions passed")
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
        precondition(BotQuestion.formReply(form, answers: ["us, eu", "Keep"])
            == "Which regions?\nus, eu\n\nKeep the old cluster?\nKeep")
        precondition(BotQuestion.formReply([form[0]], answers: ["us"]) == "us")
        precondition(several.ownBody == nil)
        // The agent's own separators stay: only the list the backend appends last is dropped.
        var ruled = AgentConversation.InputRequest(id: "e", category: "preference", question: "Rollout",
                                                   options: nil, askedAt: nil)
        ruled.body = "Findings.\n\n---\n\nRisks.\n\n---\n\n**1. Which regions?**"
        ruled.questions = form
        precondition(ask(ruled).ownBody == "Findings.\n\n---\n\nRisks.")
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
        // Up to three short lines show whole; more collapses behind "Show more".
        precondition(!BotQuestion.isLongBody("One finding.\nA second.\nA third."))
        precondition(BotQuestion.isLongBody("1\n2\n3\n4"))
        precondition(BotQuestion.isLongBody(String(repeating: "x", count: 241)))
    }

    private static func aPlanOrASecretIsNeverAnsweredInWords() {
        func ask(_ category: String, planId: String? = nil) -> BotQuestion {
            BotQuestion(sessionId: "s", title: "Agent", request: .init(
                id: "r", category: category, question: "Go?", options: ["Approve", "Reject"], askedAt: nil, planId: planId))
        }
        precondition(ask("preference").typed)
        precondition(!ask("approval", planId: "p1").typed)
        precondition(!ask("credential").typed)
        precondition(!ask("integration").typed)
        let plan = try! JSONDecoder().decode(
            AgentConversation.InputRequest.self, from: Data(#"{"id":"r","question":"Approve?","planId":"p1"}"#.utf8))
        precondition(plan.planId == "p1")
        // "Other…" quotes the question above the composer, a quote no post in the chat has.
        precondition(ask("preference").quote == ChannelReply(id: nil, authorName: "Agent", text: "Go?"))
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
    }
}
