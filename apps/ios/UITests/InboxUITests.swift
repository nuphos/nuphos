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
        XCTAssertTrue(app.textFields["Reply to this question"].firstMatch.exists, "No typed answer")
        shot("3-inbox")

        // The answer leaves the Inbox at once; the listing then agrees.
        app.buttons["Ship it"].tap()
        try listQuestions([staging])
        XCTAssertTrue(app.staticTexts["Roll out 1.4 to production?"].waitForNonExistence(timeout: 5), "The answered question stayed")
        XCTAssertTrue(app.staticTexts["Which node pool should the staging cluster use?"].exists)
        shot("4-answered")

        // "From …" opens the conversation that asked.
        app.buttons["botQuestion.from"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars.staticTexts["Check the staging cluster"].waitForExistence(timeout: 10)
                      || app.staticTexts["Check the staging cluster"].waitForExistence(timeout: 1),
                      "The asking conversation did not open")
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
