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
                                   ("agent-ops", "q-rollout"), ("bot-release", "q-deploy"), ("bot-release", "q-notes")] {
            responses["POST /agent/conversations/\(session)/decisions/\(request)/answer"] = ["status": 200, "body": ["ok": true]]
        }
        // The asking conversations, opened by "From …" and "Other…".
        for (id, title) in [("agent-ops", "Release ops"), ("agent-staging", "Check the staging cluster")] {
            responses["GET /agent/conversations/\(id)"] = ["status": 200, "body": [
                "title": title, "messages": [], "timelineEvents": [], "isOwner": true, "readOnly": false]]
        }
        try listQuestions([deploy, notes, staging])
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    /// The list groups the questions by who asked, one line each; a question opens on its own,
    /// an answer leaves the list with a toast and opens the next one.
    func testAnswersAQuestionFromTheInbox() throws {
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()

        let menu = app.buttons["Switch page"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 10), "No page menu")
        let badged = NSPredicate(format: "value CONTAINS %@", "3 in Inbox")
        expectation(for: badged, evaluatedWith: menu)
        waitForExpectations(timeout: 10)
        shot("1-badge")

        menu.tap()
        let inbox = app.buttons["Inbox"].firstMatch
        XCTAssertTrue(inbox.waitForExistence(timeout: 5), "No Inbox in the page menu")
        inbox.tap()

        // Grouped under who asked; still badged on the Inbox title.
        let row = app.staticTexts["Roll out 1.4 to production?"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), "The question is not listed")
        XCTAssertTrue(app.staticTexts["Release Lead"].exists, "No group for the Bot that asked")
        XCTAssertTrue(app.staticTexts["Check the staging cluster"].exists, "No group for the Task that asked")
        XCTAssertTrue(menu.value.map { "\($0)".contains("3 in Inbox") } ?? false, "The Inbox title lost its badge")
        XCTAssertFalse(app.buttons["Mark as done"].exists, "A to-do is still marked done")
        shot("2-list")

        row.tap()
        XCTAssertTrue(app.buttons["Ship it"].waitForExistence(timeout: 5), "The question did not open")
        XCTAssertTrue(app.buttons["inbox.source"].exists, "No link to who asked")
        XCTAssertFalse(app.buttons["Open conversation"].exists)
        XCTAssertTrue(app.buttons["Skip"].exists)
        shot("3-question")

        // The answer leaves the list, says so, and opens the next question.
        app.buttons["Ship it"].tap()
        try listQuestions([notes, staging])
        let toast = app.descendants(matching: .any)["inbox.toast"]
        XCTAssertTrue(toast.waitForExistence(timeout: 5), "No toast for the answer")
        XCTAssertTrue(toast.label.contains("Roll out 1.4 to production?"), "The toast does not say what was answered")
        XCTAssertTrue(app.buttons["Friendly"].waitForExistence(timeout: 5), "The next question did not open")
        shot("4-answered")

        // Skip opens the one after it without answering.
        app.buttons["Skip"].tap()
        XCTAssertTrue(app.staticTexts["Which node pool should the staging cluster use?"].waitForExistence(timeout: 5),
                      "Skip did not open the next question")

        // The source's name opens the conversation that asked.
        app.buttons["inbox.source"].tap()
        XCTAssertTrue(app.navigationBars.staticTexts["Check the staging cluster"].waitForExistence(timeout: 10)
                      || app.staticTexts["Check the staging cluster"].waitForExistence(timeout: 1),
                      "The asking conversation did not open")
    }

    /// "Other…" opens a text box with its send button; the words are the answer. A question with
    /// no options has the box already. A plan keeps only Approve and Reject.
    func testAnswersInWordsWithOther() throws {
        try listQuestions([deploy, staging, plan])
        app = launch(page: "agent")
        app.buttons["Switch page"].firstMatch.tap()
        app.buttons["Inbox"].firstMatch.tap()

        app.staticTexts["Roll out 1.4 to production?"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Other…"].waitForExistence(timeout: 10), "No Other…")
        XCTAssertFalse(app.textFields["Your answer"].exists, "The text box shows before Other…")
        app.buttons["Other…"].tap()
        let words = app.textFields["Your answer"].firstMatch
        XCTAssertTrue(words.waitForExistence(timeout: 5), "Other… does not open a text box")
        words.typeText("Ship after the 18:00 freeze")
        shot("5-other")
        app.buttons["Send answer"].firstMatch.tap()
        try listQuestions([staging, plan])
        XCTAssertTrue(app.descendants(matching: .any)["inbox.toast"].waitForExistence(timeout: 5), "No toast for the answer")

        // Words only: the box is there without Other….
        openQuestion("Which node pool should the staging cluster use?")
        XCTAssertTrue(app.textFields["Your answer"].waitForExistence(timeout: 5), "No text box without options")
        XCTAssertFalse(app.buttons["Other…"].exists)

        // A plan: Approve or Reject, nothing in words.
        openQuestion("Approve the plan \"Move staging to the new cluster\"?")
        XCTAssertTrue(app.buttons["Approve"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Other…"].exists, "A plan is answered in words")
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
        openQuestion("Select your own GitHub so I can open the PR as you.")
        let choose = app.buttons["Choose credentials"]
        XCTAssertTrue(choose.waitForExistence(timeout: 10), "The integration card does not offer its credentials")
        shot("9-inbox-integration")

        choose.tap()
        let own = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "octocat")).firstMatch
        XCTAssertTrue(own.waitForExistence(timeout: 10), "The picker does not list the member's own GitHub")
        own.tap()
        shot("10-inbox-integration-picker")
        app.buttons["Done"].firstMatch.tap()
        // Saved in place: the Inbox stays.
        XCTAssertTrue(app.staticTexts["Select your own GitHub so I can open the PR as you."].waitForExistence(timeout: 5))

        openQuestion("Connect your own GitHub so I can push as you.")
        XCTAssertTrue(app.buttons["Use your own GitHub"].waitForExistence(timeout: 5),
                      "The own-GitHub question does not offer the member's credential")
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
        openQuestion("How should the staging rollout go?")
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

    /// Its row in the list; wide, it may already be open beside it.
    private func openQuestion(_ question: String) {
        let back = app.navigationBars.buttons.firstMatch
        if !app.staticTexts[question].firstMatch.waitForExistence(timeout: 2), back.exists { back.tap() }
        app.staticTexts[question].firstMatch.tap()
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
         "body": "CI passed on `main`. The release adds **two migrations**, both backwards compatible.\n\n- Canary: 5% for 30 minutes\n- Rollback: `acme rollout undo`",
         "options": ["Ship it", "Wait for QA"], "askedAt": "2026-11-03T09:40:00Z", "status": "open"])
    /// A Bot's: its group wears the Bot's face.
    private let notes: [String: Any] = {
        var row = InboxUITests.row(
            "bot-release", "Release Lead",
            ["id": "q-notes", "category": "preference", "question": "Which tone should the 1.4 release notes take?",
             "body": "Drafts for both are in the release doc.",
             "options": ["Friendly", "Formal"], "askedAt": "2026-11-03T09:30:00Z", "status": "open"])
        row["avatar"] = "05"
        return row
    }()
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
