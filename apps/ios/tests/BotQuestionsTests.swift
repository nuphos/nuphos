import Foundation

enum BotQuestionsTests {
    static func run() {
        listsTheBotsQuestionsAtAnyDepth()
        leavesOutOtherBotsAndTeammates()
        decodesTheOpenRequestsOfAListRow()
        aConversationKnowsWhichQuestionDecidesAPlan()
        theInboxListsEveryOwnQuestionOnce()
        print("Bot questions passed")
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

    private static func aConversationKnowsWhichQuestionDecidesAPlan() {
        // What PlanAnswer looks up: the open question that names the plan.
        let json = """
        {"messages":[],"inputRequests":[
         {"id":"q-1","question":"Ship?","options":["Yes"]},
         {"id":"nuphos-plan-7-1","category":"approval","question":"Approve plan #7?",
          "options":["Approve","Reject"],"planId":"7","status":"open"}]}
        """
        let detail = try! JSONDecoder().decode(AgentConversationDetail.self, from: Data(json.utf8))
        precondition(detail.inputRequests.first(where: { $0.planId == "7" })?.id == "nuphos-plan-7-1")
        let bare = try! JSONDecoder().decode(AgentConversationDetail.self, from: Data(#"{"messages":[]}"#.utf8))
        precondition(bare.inputRequests.isEmpty)
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
}
