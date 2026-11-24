import XCTest

/// Tasks laid out as on Desktop (#2703): grouped under their projects, the
/// families that need the viewer above a line, and the Archived entry last.
final class TasksLayoutArchiveUITests: XCTestCase {
    private static let team = "64b5f1c2e4b0a1d2c3e4f5a6"
    private var live: URL!
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "tasks-layout-live-\(UUID().uuidString).json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        let tasks = [
            Self.row("agent-api", "Ship the API", at: "09:40", workspace: "/Users/me/src/api"),
            Self.row("agent-tests", "Run the API tests", at: "09:30", parent: "agent-api"),
            Self.row("agent-web", "Fix the web build", at: "09:10", workspace: "/Users/me/src/web", unread: true),
            Self.row("agent-mail", "Answer the support mail", at: "09:50"),
        ]
        responses["GET /agent/conversations"] = Self.page(tasks)
        responses["GET /agent/conversations?bots=true"] = Self.page([])
        responses["GET /agent/conversations?kind=channel"] = Self.page([])
        responses["GET /agent/conversations?pendingDecision=true"] = Self.page([])
        responses["GET /agent/conversations?sort=archived"] = Self.page([
            Self.row("agent-old", "Migrate the old database", at: "08:00"),
        ])
        // The archived Task, opened from the list: read-only until restored.
        responses["GET /agent/conversations/agent-old"] = ["status": 200, "body": [
            "sessionId": "agent-old", "title": "Migrate the old database", "isOwner": true, "canManage": true, "readOnly": false,
            "archivedAt": "2026-11-04T08:00:00Z", "messageCount": 2, "messagesFirstIndex": 0, "timelineEvents": [] as [Any],
            "activitySeq": 2, "readSeq": 2,
            "messages": [
                ["id": "m1", "role": "user", "parts": [["type": "text", "text": "Move the orders table to the new cluster."]],
                 "createdAt": "2026-11-03T07:50:00.000Z"],
                ["id": "m2", "role": "assistant", "parts": [["type": "text", "text": "Done. The orders table now lives on the new cluster."]],
                 "createdAt": "2026-11-03T08:00:00.000Z"],
            ],
        ]]
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testTasksGroupUnderProjectsAndArchivedIsLast() throws {
        launch()
        let web = app.staticTexts["Fix the web build"].firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 10), "Tasks did not load")
        for project in ["web", "api", "No project"] {
            XCTAssertTrue(app.staticTexts[project].exists, "No \(project) project row")
        }
        // The unread family leads; the rest by their newest activity, threads included.
        let mail = app.staticTexts["Answer the support mail"].firstMatch
        let api = app.staticTexts["Ship the API"].firstMatch
        XCTAssertLessThan(web.frame.minY, mail.frame.minY)
        XCTAssertLessThan(mail.frame.minY, api.frame.minY)
        XCTAssertGreaterThan(web.frame.minX, app.staticTexts["web"].firstMatch.frame.minX, "A Task is not under its project")
        XCTAssertTrue(app.staticTexts["Run the API tests"].exists, "A thread left its parent")
        shot("1-tasks-projects")

        // A project row folds what it holds.
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'api'")).firstMatch.tap()
        XCTAssertTrue(api.waitForNonExistence(timeout: 3), "Folding the project kept its Tasks")
        shot("2-project-folded")

        let archived = app.buttons["Archived"].firstMatch
        if !archived.isHittable { app.swipeUp() }
        archived.tap()
        let old = app.staticTexts["Migrate the old database"].firstMatch
        XCTAssertTrue(old.waitForExistence(timeout: 5), "Archived lists nothing")
        shot("3-archived")
        old.tap()
        // The sheet gives way to the Task's chat.
        XCTAssertTrue(app.buttons["Done"].waitForNonExistence(timeout: 5), "Opening an archived Task kept the sheet")
        shot("4-archived-opened")
    }

    /// No live Tasks, only archived ones: the empty state still leads to them.
    func testArchivedIsReachableWithNoLiveTasks() throws {
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: live)) as? [String: Any])
        responses["GET /agent/conversations"] = Self.page([])
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
        launch()
        XCTAssertTrue(app.staticTexts["No tasks yet"].waitForExistence(timeout: 10), "Tasks is not empty")
        let archived = app.buttons["Archived"].firstMatch
        XCTAssertTrue(archived.waitForExistence(timeout: 5), "The empty Tasks page has no way to its archived Tasks")
        shot("5-empty-archived")
        archived.tap()
        let old = app.staticTexts["Migrate the old database"].firstMatch
        XCTAssertTrue(old.waitForExistence(timeout: 5), "Archived lists nothing")
        old.tap()
        XCTAssertTrue(app.buttons["Done"].waitForNonExistence(timeout: 5), "Opening an archived Task kept the sheet")
    }

    private func launch() {
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent", "-nuphos.agent.foldedThreads", "{}"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
    }

    private static func row(
        _ id: String, _ title: String, at time: String, parent: String? = nil, workspace: String? = nil, unread: Bool = false
    ) -> [String: Any] {
        var row: [String: Any] = [
            "sessionId": id, "teamId": team, "title": title, "firstMessage": title, "messageCount": 4,
            "createdAt": "2026-11-03T08:00:00Z", "lastActiveAt": "2026-11-03T\(time):00Z",
            "isOwner": true, "readOnly": false, "agentRuntime": "claude-code",
            "runtimeId": "11111111-1111-4111-8111-111111111111", "runtimeLabel": "Preview Codex",
            "runtimeState": ["schemaVersion": 2, "epoch": "test", "revision": 1, "state": "idle", "phase": "idle",
                             "actions": ["send": true, "cancel": false, "reply": false, "steer": false]],
            "activitySeq": unread ? 3 : 2, "readSeq": 2,
        ]
        if let parent { row["parentSessionId"] = parent }
        if let workspace { row["workspace"] = ["path": workspace] }
        return row
    }

    private static func page(_ rows: [[String: Any]]) -> [String: Any] {
        ["status": 200, "body": ["conversations": rows, "parents": [], "nextCursor": NSNull(), "hasMore": false]]
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
