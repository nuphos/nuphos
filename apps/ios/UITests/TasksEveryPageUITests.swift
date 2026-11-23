import XCTest

/// Tasks lists what the Desktop sidebar lists however much of the recent
/// activity is Bot work (#4601): every page of the viewer's own agents and of
/// those shared with them, then without Bots and what they dispatched. Uses a
/// copy of the offline chats fixture with its own rows.
final class TasksEveryPageUITests: XCTestCase {
    private static let team = "64b5f1c2e4b0a1d2c3e4f5a6"
    private var live: URL!
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "tasks-every-page-live-\(UUID().uuidString).json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        let bot = Self.row("bot-lead", "Release Lead", at: "09:00", avatar: "05-rembrandt")
        // The first page of the viewer's own agents is all Bot work, so it lists no Task.
        let firstPage = [bot] + (10...59).map { Self.row("dispatched-\($0)", "Dispatched job \($0)", at: "09:\($0)", parent: "bot-lead") }
        responses["GET /agent/conversations"] = Self.page(firstPage, next: "mine-2")
        responses["GET /agent/conversations?cursor=mine-2"] = Self.page([Self.row("agent-keys", "Rotate the API keys", at: "08:30")])
        // A teammate's Task the viewer was invited to.
        let shared = Self.row("agent-runbook", "Review the shared runbook", at: "08:20")
            .merging(["isOwner": false, "canManage": false, "canArchive": true]) { $1 }
        responses["GET /agent/conversations?scope=shared"] = Self.page([shared])
        responses["GET /agent/conversations?bots=true"] = Self.page([bot])
        responses["GET /agent/conversations?kind=channel"] = Self.page([])
        responses["GET /agent/conversations?pendingDecision=true"] = Self.page([])
        responses["GET /agent/triggers"] = ["status": 200, "body": [] as [Any]]
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testTasksListsEveryPageOfOwnAndSharedTasks() throws {
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent", "-nuphos.agent.foldedThreads", "{}"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let keys = app.staticTexts["Rotate the API keys"].firstMatch
        XCTAssertTrue(keys.waitForExistence(timeout: 10), "A Task on a later page is not listed")
        XCTAssertTrue(app.staticTexts["Review the shared runbook"].exists, "A Task shared with the viewer is not listed")
        XCTAssertFalse(app.staticTexts["No tasks yet"].exists, "Tasks says it has none")
        XCTAssertFalse(app.staticTexts["Release Lead"].exists, "A Bot is listed in Tasks")
        XCTAssertFalse(app.staticTexts["Dispatched job 59"].exists, "What a Bot dispatched is listed in Tasks")
        shot("1-tasks-every-page")
    }

    private static func row(
        _ id: String, _ title: String, at time: String, parent: String? = nil, avatar: String? = nil
    ) -> [String: Any] {
        var row: [String: Any] = [
            "sessionId": id, "teamId": team, "title": title, "firstMessage": title, "messageCount": 4,
            "createdAt": "2026-11-03T08:00:00Z", "lastActiveAt": "2026-11-03T\(time):00Z",
            "isOwner": true, "readOnly": false, "agentRuntime": "claude-code",
            "runtimeId": "11111111-1111-4111-8111-111111111111", "runtimeLabel": "Preview Codex",
            "runtimeState": ["schemaVersion": 2, "epoch": "test", "revision": 1, "state": "idle", "phase": "idle",
                             "actions": ["send": true, "cancel": false, "reply": false, "steer": false]],
            "activitySeq": 2, "readSeq": 2,
        ]
        if let parent { row["parentSessionId"] = parent }
        if let avatar { row["avatar"] = avatar }
        return row
    }

    private static func page(_ rows: [[String: Any]], next: String? = nil) -> [String: Any] {
        ["status": 200, "body": ["conversations": rows, "parents": [], "nextCursor": next ?? NSNull(), "hasMore": next != nil]]
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
