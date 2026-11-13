import XCTest

/// The Inbox lists the open questions of every conversation, badges their
/// count on the page menu, and answers one from its card. Uses a copy of the
/// offline chats fixture, rewritten while the app runs.
final class InboxUITests: XCTestCase {
    private let pending = "GET /agent/conversations?pendingDecision=true"
    private var live: URL!
    private var responses: [String: Any] = [:]
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "inbox-live-\(UUID().uuidString).json")
        responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        responses["POST /agent/chat"] = ["status": 200, "body": [:], "headers": ["Content-Type": "text/event-stream"]]
        // An answer goes to the answer API; no message is sent.
        for (session, request) in [("agent-ops", "q-deploy"), ("agent-staging", "q-staging"),
                                   ("agent-ops", "q-rollout"), ("bot-release", "q-deploy")] {
            responses["POST /agent/conversations/\(session)/decisions/\(request)/answer"] = ["status": 200, "body": ["ok": true]]
        }
        // The asking conversations, opened by "From …" and "Other…".
        for (id, title) in [("agent-ops", "Release ops"), ("agent-staging", "Check the staging cluster")] {
            responses["GET /agent/conversations/\(id)"] = ["status": 200, "body": [
                "title": title, "messages": [], "timelineEvents": [], "isOwner": true, "readOnly": false]]
        }
        try listQuestions([deploy, staging])
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testAnswersAQuestionFromTheInbox() throws {
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()

        let menu = app.buttons["Switch page"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 10), "No page menu")
        let badged = NSPredicate(format: "value CONTAINS %@", "2 in Inbox")
        expectation(for: badged, evaluatedWith: menu)
        waitForExpectations(timeout: 10)
        shot("1-badge")

        menu.tap()
        let inbox = app.buttons["Inbox"].firstMatch
        XCTAssertTrue(inbox.waitForExistence(timeout: 5), "No Inbox in the page menu")
        shot("2-menu")
        inbox.tap()

        XCTAssertTrue(app.staticTexts["Roll out 1.4 to production?"].waitForExistence(timeout: 5), "The question is not listed")
        XCTAssertTrue(app.staticTexts["Which node pool should the staging cluster use?"].exists)
        XCTAssertTrue(app.textFields["Your answer"].firstMatch.exists, "No text box to answer in words")
        XCTAssertFalse(app.buttons["Mark as done"].exists, "A to-do is still marked done")
        shot("3-inbox")

        // The answer leaves the Inbox at once; the listing then agrees.
        app.buttons["Ship it"].tap()
        try listQuestions([staging])
        XCTAssertTrue(app.staticTexts["Roll out 1.4 to production?"].waitForNonExistence(timeout: 5), "The answered question stayed")
        XCTAssertTrue(app.staticTexts["Which node pool should the staging cluster use?"].exists)
        shot("4-answered")

        // "From …" opens the conversation that asked.
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "From Check the staging cluster")).firstMatch.tap()
        XCTAssertTrue(app.navigationBars.staticTexts["Check the staging cluster"].waitForExistence(timeout: 10)
                      || app.staticTexts["Check the staging cluster"].waitForExistence(timeout: 1),
                      "The asking conversation did not open")
    }

    /// The Inbox card has the text box for an answer in words, which sends it as the answer: no
    /// "Other…", no "Mark as done", no composer, no message. A plan keeps only Approve and Reject.
    func testAnswersInWordsInTheCard() throws {
        try listQuestions([deploy, staging, plan])
        app = launch(page: "agent")
        app.buttons["Switch page"].firstMatch.tap()
        app.buttons["Inbox"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Roll out 1.4 to production?"].waitForExistence(timeout: 10), "The question is not listed")
        // A text box beside options and without them, none on the plan; nothing to open it.
        // By label: the card's own identifier covers those inside it.
        XCTAssertEqual(app.textFields.matching(NSPredicate(format: "label == %@ OR placeholderValue == %@", "Your answer", "Your answer")).count, 2)
        XCTAssertEqual(app.buttons.matching(Self.typedAnswer).count, 0)
        XCTAssertFalse(app.buttons["Mark as done"].exists, "A to-do is still marked done")
        shot("5-inbox-in-place")

        // Newest first: the deploy question's box.
        let words = app.textFields["Your answer"].firstMatch
        words.tap()
        words.typeText("Ship after the 18:00 freeze\n")
        shot("6-inbox-typed")
        app.buttons["Send answer"].firstMatch.tap()
        try listQuestions([staging, plan])
        XCTAssertTrue(app.staticTexts["Roll out 1.4 to production?"].waitForNonExistence(timeout: 5), "The answered question stayed")
    }

    /// In a Bot's chat too, "Other…" asks for the answer in the card, not in the chat's composer.
    func testOtherAnswersInWordsInABotChat() throws {
        // The release chat as a Bot's 1:1, whose own questions show in it.
        var detail = try XCTUnwrap(responses["GET /agent/conversations/chat-release"] as? [String: Any])
        var body = try XCTUnwrap(detail["body"] as? [String: Any])
        body["faces"] = [["id": "bot-release", "name": "Release Lead", "agent": ["avatar": "05"]]]
        detail["body"] = body
        responses["GET /agent/conversations/chat-release"] = detail
        let ask = { (row: [String: Any]) in (row["inputRequests"] as? [[String: Any]])?.first ?? [:] }
        var own = InboxUITests.row("bot-release", "Release Lead", ask(deploy))
        own["inputRequests"] = [ask(deploy), ask(plan)]
        try listQuestions([own])
        app = launch()
        app.staticTexts["release-planning"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Roll out 1.4 to production?"].waitForExistence(timeout: 15),
                      "The Bot's question is not in its chat")
        XCTAssertEqual(app.buttons.matching(Self.typedAnswer).count, 1, "Other… on the plan, or missing")
        shot("7-bot-chat")

        app.buttons["Other…"].firstMatch.tap()
        XCTAssertTrue(app.textFields["Your answer"].waitForExistence(timeout: 5),
                      "Other… does not ask for the answer in the card")
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "Replying to")).firstMatch.exists,
                       "The chat's composer quotes the question")
        shot("8-bot-chat-other-typed")
    }

    /// An integration question is answered in the Inbox: its conversation's credential picker
    /// opens there, with the member's own GitHub to select, and nothing navigates away.
    func testAnIntegrationQuestionChoosesCredentialsInTheInbox() throws {
        responses["GET /agent/credential-options"] = ["status": 200, "body": [
            "personalCredentials": [["provider": "github", "login": "octocat"]]]]
        responses["PATCH /agent/conversations/agent-ops/credentials"] = ["status": 200, "body": [
            "credentialAccess": ["personalCredentialIds": ["github"]], "options": [:]]]
        var github = deploy
        github["inputRequests"] = [["id": "q-github", "category": "integration",
                                    "question": "Select your own GitHub so I can open the PR as you.",
                                    "providers": ["github"], "askedAt": "2026-11-03T09:40:00Z", "status": "open"],
                                   // One naming the member's own GitHub: answered by that alone, with no picker.
                                   ["id": "q-own", "category": "integration",
                                    "question": "Connect your own GitHub so I can push as you.",
                                    "credentials": [["provider": "personal", "id": "github"]],
                                    "askedAt": "2026-11-03T09:41:00Z", "status": "open"]]
        try listQuestions([github])
        app = launch(page: "agent")
        app.buttons["Switch page"].firstMatch.tap()
        app.buttons["Inbox"].firstMatch.tap()
        let choose = app.buttons["Choose credentials"]
        XCTAssertTrue(choose.waitForExistence(timeout: 10), "The integration card does not offer its credentials")
        XCTAssertFalse(app.buttons["Answer in the conversation"].exists)
        XCTAssertTrue(app.buttons["Use your own GitHub"].exists, "The own-GitHub question does not offer the member's credential")
        shot("9-inbox-integration")

        choose.tap()
        let own = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "octocat")).firstMatch
        XCTAssertTrue(own.waitForExistence(timeout: 10), "The picker does not list the member's own GitHub")
        own.tap()
        shot("10-inbox-integration-picker")
        app.buttons["Done"].firstMatch.tap()
        // Saved in place: the Inbox stays.
        XCTAssertTrue(app.staticTexts["Select your own GitHub so I can open the PR as you."].waitForExistence(timeout: 5))
    }

    /// A card asking several questions, one of them multi-select, is a form answered in the Inbox
    /// with one reply: options toggled, or the answer typed in their place.
    func testAnswersSeveralQuestionsInOneCard() throws {
        let rollout = InboxUITests.row(
            "agent-ops", "Release ops",
            ["id": "q-rollout", "category": "preference", "question": "How should the staging rollout go?",
             // As the backend sends it: the questions written out after the separator for older clients.
             "body": "The new build passed CI.\n\n---\n\n**1. Which regions should get it first?** (any number)\n- us-east\n- eu-west\n- ap-south\n\n**2. Keep the old cluster afterwards?**\n- Keep it for a week\n- Delete it\n\n**3. Anything the release note must mention?**",
             "questions": [
                ["question": "Which regions should get it first?", "options": ["us-east", "eu-west", "ap-south"],
                 "multiSelect": true],
                ["question": "Keep the old cluster afterwards?", "options": ["Keep it for a week", "Delete it"]],
                ["question": "Anything the release note must mention?"],
             ],
             "askedAt": "2026-11-03T09:40:00Z", "status": "open"])
        try listQuestions([rollout])
        app = launch(page: "agent")
        app.buttons["Switch page"].firstMatch.tap()
        app.buttons["Inbox"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["How should the staging rollout go?"].waitForExistence(timeout: 10),
                      "The question is not listed")
        shot("11-inbox-several-questions")
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "(any number)")).firstMatch.exists,
                       "The list written out for older clients shows beside the form")

        // By label: the card's own identifier covers those inside it.
        let send = app.buttons["Send answer"]
        XCTAssertTrue(send.exists && !send.isEnabled, "Send answer before every question is answered")
        app.buttons["us-east"].tap()
        app.buttons["eu-west"].tap()
        app.buttons["Keep it for a week"].tap()
        let note = app.textFields["Your answer"]
        note.tap()
        note.typeText("Mention the new region picker.\n")
        XCTAssertTrue(send.isEnabled)
        shot("12-inbox-several-questions-filled")

        send.tap()
        try listQuestions([])
        XCTAssertTrue(app.staticTexts["How should the staging rollout go?"].waitForNonExistence(timeout: 5),
                      "The answered question stayed")
    }

    private static let typedAnswer = NSPredicate(format: "label IN %@", ["Other…", "Reply…"])

    private func launch(page: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"] + (page.map { ["-page", $0] } ?? [])
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        return app
    }

    // MARK: - Fixture

    private let deploy: [String: Any] = InboxUITests.row(
        "agent-ops", "Release ops",
        ["id": "q-deploy", "category": "approval", "question": "Roll out 1.4 to production?",
         "options": ["Ship it", "Wait for QA"], "askedAt": "2026-11-03T09:40:00Z", "status": "open"])
    private let staging: [String: Any] = InboxUITests.row(
        "agent-staging", "Check the staging cluster",
        ["id": "q-staging", "category": "preference", "question": "Which node pool should the staging cluster use?",
         "options": [], "askedAt": "2026-11-03T09:10:00Z", "status": "open"])

    private let plan: [String: Any] = InboxUITests.row(
        "agent-migrate", "Migrate staging",
        ["id": "q-plan", "category": "approval", "question": "Approve the plan \"Move staging to the new cluster\"?",
         "options": ["Approve", "Reject"], "planId": "p1", "askedAt": "2026-11-03T09:20:00Z", "status": "open"])

    private static func row(_ id: String, _ title: String, _ request: [String: Any]) -> [String: Any] {
        ["sessionId": id, "teamId": "64b5f1c2e4b0a1d2c3e4f5a6", "title": title, "firstMessage": title,
         "messageCount": 4, "createdAt": "2026-11-03T08:00:00Z", "lastActiveAt": "2026-11-03T09:40:00Z",
         "isOwner": true, "readOnly": false, "agentRuntime": "claude-code", "inputRequests": [request]]
    }

    private func listQuestions(_ rows: [[String: Any]]) throws {
        responses[pending] = ["status": 200, "body": ["conversations": rows, "parents": [], "nextCursor": NSNull(), "hasMore": false]]
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
    }

    /// The simulator's screen only; also saved to `NUPHOS_SHOTS` when the run sets it.
    private func shot(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["NUPHOS_SHOTS"] {
            try? screenshot.pngRepresentation.write(to: URL(filePath: dir).appending(path: "\(name).png"))
        }
    }
}
