import XCTest

/// One test per way into the product (#4205). Each starts on a screen a person
/// is already on and walks the real UI to one entry point, so a change that
/// takes the entry point away has to delete a test that says, by name, what is
/// being taken away.
///
/// The subject is the path, not the screen it ends on. A design is free to move
/// an entry point; it then changes the test that names it, where a reviewer sees
/// the decision instead of a side effect. Nothing here compares screenshots.
final class EntryPointReachabilityUITests: XCTestCase {
    private static let team = "64b5f1c2e4b0a1d2c3e4f5a6"
    private var live: URL!
    private var app: XCUIApplication!

    /// The offline chats fixture, with a Bot that has a chat of its own and a
    /// Task that is waiting for an answer, so the Bot and Inbox paths arrive
    /// somewhere. Fictional names throughout.
    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        live = FileManager.default.temporaryDirectory.appending(path: "entry-points-\(UUID().uuidString).json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])

        let bot = Self.task("bot-lead", "Release Lead")
        var waiting = Self.task("agent-staging", "Check the staging cluster")
        waiting["inputRequests"] = [["id": "q-staging", "category": "preference",
                                     "question": "Which node pool should the staging cluster use?",
                                     "options": ["Shared", "Dedicated"],
                                     "askedAt": "2026-11-03T09:10:00Z", "status": "open"]]
        responses["GET /agent/conversations?bots=true"] = Self.page([bot])
        responses["GET /agent/conversations?pendingDecision=true"] = Self.page([waiting])
        responses["GET /agent/conversations/bot-lead"] = ["status": 200, "body": [
            "sessionId": "bot-lead", "title": "Release Lead", "messages": [], "timelineEvents": [],
            "isOwner": true, "readOnly": false, "canManage": true]]
        responses["GET /agent/conversations/agent-staging"] = ["status": 200, "body": [
            "sessionId": "agent-staging", "title": "Check the staging cluster", "messages": [], "timelineEvents": [],
            "isOwner": true, "readOnly": false, "canManage": true]]
        // The Task the controls row is read on. It has a message, because a Task
        // with none is new and a new Task picks a runtime instead of switching
        // one; and it is idle, because a Task cannot change runtime mid-turn.
        let idle: [String: Any] = ["schemaVersion": 2, "epoch": "test", "revision": 3,
                                   "state": "idle", "phase": "idle",
                                   "actions": ["send": true, "cancel": false, "reply": false, "steer": false]]
        responses["GET /agent/conversations/agent-ops"] = ["status": 200, "body": [
            "sessionId": "agent-ops", "title": "Release ops", "timelineEvents": [],
            "messages": [["id": "m1", "role": "user", "parts": [["type": "text", "text": "Check the release branch."]],
                          "createdAt": "2026-11-03T09:00:00.000Z"]],
            "messagesFirstIndex": 0, "runtimeState": idle,
            "isOwner": true, "readOnly": false, "canManage": true, "agentRuntime": "claude-code",
            "runtimeId": "11111111-1111-4111-8111-111111111111", "runtimeLabel": "Preview Codex"]]
        if var list = responses["GET /agent/conversations"] as? [String: Any],
           var listBody = list["body"] as? [String: Any],
           let listRows = listBody["conversations"] as? [[String: Any]] {
            listBody["conversations"] = listRows.map {
                $0["sessionId"] as? String == "agent-ops" ? $0.merging(["runtimeState": idle]) { $1 } : $0
            }
            list["body"] = listBody
            responses["GET /agent/conversations"] = list
        }

        var channels = try XCTUnwrap(responses["GET /agent/conversations?kind=channel"] as? [String: Any])
        var body = try XCTUnwrap(channels["body"] as? [String: Any])
        var rows = try XCTUnwrap(body["conversations"] as? [[String: Any]])
        rows.insert(Self.botChat, at: 0)
        body["conversations"] = rows
        channels["body"] = body
        responses["GET /agent/conversations?kind=channel"] = channels
        responses["GET /agent/conversations/chat-lead"] = ["status": 200, "body": [
            "sessionId": "chat-lead", "kind": "channel", "title": "Release Lead", "messages": [],
            "faces": [Self.face], "agentSessionIds": ["bot-lead"],
            "isOwner": true, "readOnly": false]]
        responses["GET /agent/conversations/chat-lead/agents"] = ["status": 200, "body": [
            "agents": [["sessionId": "bot-lead", "title": "Release Lead", "ownerId": "507f1f77bcf86cd799439011"]]]]
        responses["POST /agent/conversations/chat-lead/read"] = ["status": 200, "body": ["ok": true]]
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
    }

    override func tearDown() { try? FileManager.default.removeItem(at: live) }

    // MARK: - From the home screen

    /// Home → Inbox, and a question inside it. The Inbox is where questions are
    /// answered, so losing its tab loses every open question with it.
    func testHomeReachesTheInboxAndAQuestionInIt() throws {
        launch(page: "agent")
        let inbox = app.tabBars.buttons["Inbox"].firstMatch
        XCTAssertTrue(inbox.waitForExistence(timeout: 15), "The home screen has no Inbox")
        inbox.tap()
        let question = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier == 'inbox.row'")).firstMatch
        XCTAssertTrue(question.waitForExistence(timeout: 10), "The Inbox lists no open question to answer")
        shot("inbox")
    }

    /// Home → Computers & runtimes. Nothing runs without a computer, and this is
    /// the only page in the app that manages them.
    func testHomeReachesComputersAndRuntimes() throws {
        launch(page: "agent")
        reachHomeControl("Computers & runtimes").tap()
        XCTAssertTrue(app.navigationBars["Computers & runtimes"].waitForExistence(timeout: 10),
                      "Computers & runtimes did not open")
        shot("computers")
    }

    /// Home → Account → Connectors. Connectors is reached only through Account,
    /// so either half of this path going missing loses both.
    func testHomeReachesTheAccountAndItsConnectors() throws {
        launch(page: "agent")
        reachHomeControl("Account").tap()
        let connectors = app.buttons["Connectors"].firstMatch
        XCTAssertTrue(connectors.waitForExistence(timeout: 10), "Account offers no Connectors")
        connectors.tap()
        XCTAssertTrue(app.navigationBars["Connectors"].waitForExistence(timeout: 10), "Connectors did not open")
        shot("connectors")
    }

    /// Home → Create → New Task, and → New Bot. Both start the work the app is
    /// for, and both have been lost before: New Bot by being disabled (#3947).
    func testHomeReachesNewTaskAndNewBot() throws {
        launch(page: "agent")
        let create = app.buttons["Create"].firstMatch
        XCTAssertTrue(create.waitForExistence(timeout: 15), "The home screen has no Create")
        XCTAssertTrue(create.isEnabled, "Create is disabled, so neither a Task nor a Bot can be started")
        create.tap()
        let newBot = app.buttons["New Bot"].firstMatch
        XCTAssertTrue(newBot.waitForExistence(timeout: 10), "Create offers no New Bot")
        XCTAssertTrue(app.buttons["New Task"].firstMatch.exists, "Create offers no New Task")
        XCTAssertTrue(newBot.isEnabled, "New Bot is there but cannot be tapped")
        newBot.tap()
        XCTAssertTrue(app.navigationBars["New Bot"].waitForExistence(timeout: 10), "New Bot did not open")
        shot("new-bot")
    }

    // MARK: - From a chat

    /// A Bot's chat → Bot details → the Bot's own Task. The Bot's name is the
    /// only way into its details, and its details are the only listing of what
    /// the Bot dispatched.
    func testABotsChatReachesItsDetailsAndItsOwnTask() throws {
        launch(page: "chats")
        let row = app.staticTexts["Release Lead"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "The Bots page does not list the Bot")
        row.tap()
        let name = app.buttons["bot-details-entry"]
        XCTAssertTrue(name.waitForExistence(timeout: 15), "The Bot's chat has no way into its details")
        XCTAssertTrue(name.isEnabled, "The Bot's name is there but opens nothing")
        name.tap()
        let task = app.buttons["bot-task-entry"]
        XCTAssertTrue(task.waitForExistence(timeout: 10), "Bot details has no way into the Bot's own Task")
        XCTAssertTrue(task.isHittable, "The way into the Bot's own Task cannot be tapped")
        shot("bot-details")
    }

    /// A Task's chat → switch runtime, and → model settings. Both are chips in
    /// the composer's controls row, which opens when the composer is tapped, so
    /// this is the path a person takes to either of them.
    ///
    /// Where they sit in that row is #4194's subject, not this test's: on a
    /// phone they start past its right edge today, and #4193 leads the row with
    /// them. This only says both are there and that the runtime chip opens the
    /// picker.
    func testATasksChatReachesSwitchRuntimeAndModelSettings() throws {
        launch(page: "agent")
        let row = app.staticTexts["Release ops"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "Tasks does not list the Task")
        row.tap()
        XCTAssertTrue(app.buttons["agent-summary-button"].waitForExistence(timeout: 15), "The Task did not open")
        let composer = try XCTUnwrap([app.textViews.firstMatch, app.textFields.firstMatch].first { $0.waitForExistence(timeout: 10) },
                                     "The Task's chat has no composer")
        composer.tap()
        let runtime = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Switch runtime'")).firstMatch
        XCTAssertTrue(runtime.waitForExistence(timeout: 10), "The Task's chat has no way to switch its runtime")
        XCTAssertTrue(app.buttons["Model settings"].firstMatch.waitForExistence(timeout: 10),
                      "The Task's chat has no way into its model settings")
        shot("chat-controls")
        scrollControls(to: runtime)
        // An idle Task's chip takes the tap; a running one's is disabled on
        // purpose, which is why the fixture's Task is idle.
        XCTAssertTrue(runtime.isEnabled, "The runtime chip is there but cannot be used")
        runtime.tap()
        XCTAssertTrue(app.navigationBars["Choose runtime"].waitForExistence(timeout: 10),
                      "The runtime chip is there but opens no picker")
    }

    // MARK: - Helpers

    /// A home toolbar control, opening the system overflow menu when the
    /// toolbar has put it there (#3433). Reachable behind one more tap is still
    /// reachable; whether it should be visible is that issue's subject, not this
    /// suite's.
    private func reachHomeControl(_ name: String) -> XCUIElement {
        let control = app.buttons[name].firstMatch
        if control.waitForExistence(timeout: 15) { return control }
        let more = app.buttons["TopOverflowBarButtonItem"].firstMatch
        XCTAssertTrue(more.exists, "The home toolbar has neither \(name) nor an overflow menu holding it")
        more.tap()
        XCTAssertTrue(control.waitForExistence(timeout: 5), "The home toolbar has no \(name), in its overflow menu or outside it")
        return control
    }

    /// Brings a chip of the composer's controls row into reach. The row scrolls
    /// sideways, and a chip past its edge cannot be tapped where it is.
    private func scrollControls(to chip: XCUIElement) {
        let row = app.scrollViews.containing(NSPredicate(format: "label BEGINSWITH 'Switch runtime'")).firstMatch
        guard row.exists else { return }
        for _ in 0..<4 where !chip.isHittable { row.swipeLeft() }
    }

    private func launch(page: String) {
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", page, "-AppleInterfaceStyle", "Light"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
    }

    private static let face: [String: Any] = [
        "id": "bot-lead", "name": "Release Lead", "agent": ["avatar": "05-rembrandt", "provider": "claude-code"],
    ]

    private static let botChat: [String: Any] = [
        "sessionId": "chat-lead", "teamId": team, "kind": "channel", "title": "", "firstMessage": "",
        "messageCount": 3, "createdAt": "2026-11-02T08:00:00Z", "lastActiveAt": "2026-11-03T09:55:00Z",
        "isOwner": true, "readOnly": false, "activitySeq": 3, "readSeq": 3,
        "faces": [face], "agentSessionIds": ["bot-lead"],
        "lastMessage": ["text": "On it.", "from": "Release Lead"],
    ]

    private static func task(_ id: String, _ title: String) -> [String: Any] {
        ["sessionId": id, "teamId": team, "title": title, "firstMessage": title, "messageCount": 4,
         "createdAt": "2026-11-03T08:00:00Z", "lastActiveAt": "2026-11-03T09:40:00Z",
         "isOwner": true, "readOnly": false, "canManage": true, "agentRuntime": "claude-code",
         "runtimeId": "11111111-1111-4111-8111-111111111111", "runtimeLabel": "Preview Codex",
         "runtimeState": ["schemaVersion": 2, "epoch": "test", "revision": 1, "state": "idle", "phase": "idle",
                          "actions": ["send": true, "cancel": false, "reply": false, "steer": false]],
         "activitySeq": 2, "readSeq": 2]
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
