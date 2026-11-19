import XCTest

/// Bots and Tasks list what the Desktop sidebar lists (#2703): a Bot's chat
/// is named after the Bot and carries what the Bot dispatched, which Tasks
/// leaves out. Uses a copy of the offline chats fixture with its own rows.
final class BotsAndTasksListUITests: XCTestCase {
    private static let team = "64b5f1c2e4b0a1d2c3e4f5a6"
    private var live: URL!
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "bots-tasks-live-\(UUID().uuidString).json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        let bots = [
            Self.row("bot-lead", "Release Lead", at: "09:00", avatar: "05-rembrandt"),
            Self.row("bot-docs", "Docs Bot", at: "09:00", avatar: "02-leonardo"),
            Self.row("bot-triage", "Triage Bot", at: "09:00", avatar: "07-ada"),
            // Opened by a Task, still a Bot of its own.
            Self.row("bot-helper", "Helper Bot", at: "09:20", parent: "agent-ops", avatar: "07-ada"),
        ]
        let history = bots + [
            Self.row("agent-ops", "Release ops", at: "09:00"),
            Self.row("agent-rollout", "Roll out to staging", at: "09:50", parent: "agent-ops"),
            Self.row("agent-staging", "Check the staging cluster", at: "09:30", question: "Scale the staging pool?"),
            Self.row("agent-notes", "Write the changelog", at: "09:40"),
            // A teammate's: I take part in one, and only read the other (#3686).
            Self.teammates(Self.row("agent-review", "Review the migration", at: "09:35"), canArchive: true),
            Self.teammates(Self.row("agent-offsite", "Plan the offsite", at: "09:34"), canArchive: false),
            // What the Bots dispatched, at any depth: listed under Bots, never in Tasks.
            Self.row("agent-ci", "Check the CI flake", at: "09:45", parent: "bot-lead", question: "Retry the flaky iOS job?"),
            Self.row("agent-rerun", "Rerun the iOS job", at: "09:46", parent: "agent-ci"),
            Self.row("agent-links", "Fix broken links", at: "09:44", parent: "bot-docs", working: true),
            Self.row("agent-logs", "Collect crash logs", at: "09:21", parent: "bot-helper"),
        ]
        let chats = [
            // Named before the Bot was renamed: the row shows the Bot's name.
            Self.chat("chat-lead", "release-lead-old", at: "09:55", faces: [Self.face("bot-lead", "Release Lead", "05-rembrandt")]),
            Self.chat("chat-docs", "", at: "09:52", faces: [Self.face("bot-docs", "Docs Bot", "02-leonardo")]),
            // Triage Bot is in this group chat, so it has no row of its own.
            Self.chat("chat-group", "", at: "09:48", faces: [["id": "u-ana", "name": "Ana"], Self.face("bot-triage", "Triage Bot", "07-ada")],
                      group: true, agents: ["bot-triage"]),
        ]
        responses["GET /agent/conversations"] = Self.page(history)
        responses["GET /agent/conversations?bots=true"] = Self.page(bots)
        responses["GET /agent/conversations?kind=channel"] = Self.page(chats)
        responses["GET /agent/conversations?pendingDecision=true"] = Self.page([])
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testBotsListWhatTheirBotsDispatched() throws {
        launch(page: "chats")
        let lead = app.staticTexts["Release Lead"].firstMatch
        XCTAssertTrue(lead.waitForExistence(timeout: 10), "The Bot's chat is not named after the Bot")
        XCTAssertFalse(app.staticTexts["release-lead-old"].exists, "The Bot's chat kept its own name")
        XCTAssertTrue(app.staticTexts["Needs your input: Retry the flaky iOS job?"].exists, "A dispatched question is not on the Bot's chat")
        // Its chat shows no typing for a dispatched turn, so neither does its row (#3522).
        XCTAssertFalse(app.descendants(matching: .any)["Docs Bot is thinking"].exists, "A dispatched turn shows typing dots on a chat that isn't typing")
        XCTAssertTrue(app.staticTexts["On it."].exists, "The Bot's chat row hides its latest message")
        XCTAssertTrue(app.staticTexts["New Group Chat"].exists, "An untitled group chat is not named as one")
        XCTAssertFalse(app.staticTexts["Triage Bot"].exists, "A Bot in a chat still has a row of its own")
        XCTAssertTrue(app.staticTexts["Helper Bot"].exists, "A Bot opened by a Task is not listed as a Bot")
        shot("1-bots")
    }

    /// A Bot row ends with its time, unread dot and chevron: no control expands
    /// what the Bot dispatched into the list (#3592). Those open from the Bot's page.
    func testBotRowsHaveNoExpandControl() throws {
        launch(page: "chats")
        XCTAssertTrue(app.staticTexts["Release Lead"].firstMatch.waitForExistence(timeout: 10), "Bots did not load")
        let expand = app.buttons.matching(NSPredicate(format: "label ENDSWITH 'sub-agents'"))
        XCTAssertEqual(expand.count, 0, "A Bot row has a control that expands its Tasks")
        for thread in ["Check the CI flake", "Rerun the iOS job", "Fix broken links", "Collect crash logs"] {
            XCTAssertFalse(app.staticTexts[thread].exists, "\(thread) is listed under Bots")
        }
        shot("2-bots-flat")
    }

    func testTasksLeaveOutBotsAndWhatTheyDispatched() throws {
        launch(page: "agent")
        let staging = app.staticTexts["Check the staging cluster"].firstMatch
        XCTAssertTrue(staging.waitForExistence(timeout: 10), "Tasks did not load")
        for gone in ["Release Lead", "Docs Bot", "Helper Bot", "Check the CI flake", "Rerun the iOS job", "Fix broken links", "Collect crash logs"] {
            XCTAssertFalse(app.staticTexts[gone].exists, "\(gone) is listed in Tasks")
        }
        // A question first, then each family by its newest activity: the rollout lifts Release ops.
        let ops = app.staticTexts["Release ops"].firstMatch
        let notes = app.staticTexts["Write the changelog"].firstMatch
        XCTAssertLessThan(staging.frame.minY, ops.frame.minY)
        XCTAssertLessThan(ops.frame.minY, notes.frame.minY)
        XCTAssertTrue(app.descendants(matching: .any)["Needs your input"].exists, "The waiting Task has no mark")
        shot("3-tasks")
    }

    /// Someone else in a teammate's Task archives it for themselves from its row (#3686): by a swipe…
    func testTeammatesTaskIsArchivedFromItsSwipe() throws {
        teammatesTask("Review the migration").swipeLeft()
        XCTAssertTrue(app.buttons["Archive"].waitForExistence(timeout: 5), "A Task I take part in offers no Archive")
        shot("4-teammates-task-swipe")
    }

    /// …or from its menu.
    func testTeammatesTaskIsArchivedFromItsMenu() throws {
        teammatesTask("Review the migration").press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["Archive"].waitForExistence(timeout: 5), "Its menu offers no Archive")
        shot("5-teammates-task-menu")
    }

    /// A teammate's Task I only read is not mine to archive. Its menu, as it has no swipe actions.
    func testTeammatesTaskIOnlyReadOffersNoArchive() throws {
        teammatesTask("Plan the offsite").press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["Watch"].waitForExistence(timeout: 5), "Its menu did not open")
        XCTAssertFalse(app.buttons["Archive"].exists, "A Task I only read offers Archive")
    }

    private func teammatesTask(_ title: String) -> XCUIElement {
        launch(page: "agent")
        let row = app.staticTexts[title].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "Tasks did not load")
        return row
    }

    /// What the Inbox opens, as a notification does, lands over the list that has it (#2964): Tasks
    /// lists no Bot nor what one dispatched, so those go back to Bots, never to a Tasks page without them.
    func testWhatTheInboxOpensReturnsToItsList() throws {
        var responses = try JSONSerialization.jsonObject(with: Data(contentsOf: live)) as! [String: Any]
        let pending = [Self.row("bot-lead", "Release Lead", at: "09:00", avatar: "05-rembrandt", question: "Ship 2.4 today?"),
                       Self.row("agent-ci", "Check the CI flake", at: "09:45", parent: "bot-lead", question: "Retry the flaky iOS job?"),
                       Self.row("agent-staging", "Check the staging cluster", at: "09:30", question: "Scale the staging pool?")]
        responses["GET /agent/conversations?pendingDecision=true"] = Self.page(pending)
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)

        for (question, list) in [("Ship 2.4 today?", "Bots"), ("Retry the flaky iOS job?", "Bots"), ("Scale the staging pool?", "Tasks")] {
            launch(page: "inbox")
            // The home tabs show over a list and leave the screen when a chat is open on top of it.
            let menu = app.buttons.matching(NSPredicate(format: "label == 'Tasks' AND identifier != 'BackButton'")).firstMatch
            let row = app.descendants(matching: .any)
                .matching(NSPredicate(format: "identifier == %@ AND label BEGINSWITH %@", "inbox.row", question)).firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 10), "\(question) is not in the Inbox")
            row.tap()
            let source = app.buttons["inbox.source"].firstMatch
            XCTAssertTrue(source.waitForExistence(timeout: 5), "\(question) has no source to open")
            source.tap()
            // Opened over the list: the tabs leave the screen.
            expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: menu)
            waitForExpectations(timeout: 10)
            sleep(1)
            app.navigationBars.buttons.firstMatch.tap()
            XCTAssertTrue(menu.waitForExistence(timeout: 5), "No list after going back from \(question)")
            shot("back-from-\(list)-\(question.prefix(5))")
            let tab = app.buttons.matching(NSPredicate(format: "label == %@ AND identifier != 'BackButton'", list)).firstMatch
            XCTAssertTrue(tab.isSelected, "\(question) did not go back to \(list)")
            app.terminate()
        }
    }

    /// Starts from no stored folds, so earlier runs leave nothing behind.
    private func launch(page: String) {
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", page, "-nuphos.agent.foldedThreads", "{}"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
    }

    private static func row(
        _ id: String, _ title: String, at time: String, parent: String? = nil, avatar: String? = nil,
        question: String? = nil, working: Bool = false
    ) -> [String: Any] {
        var row: [String: Any] = [
            "sessionId": id, "teamId": team, "title": title, "firstMessage": title, "messageCount": 4,
            "createdAt": "2026-11-03T08:00:00Z", "lastActiveAt": "2026-11-03T\(time):00Z",
            "isOwner": true, "readOnly": false, "agentRuntime": "claude-code",
            "runtimeId": "11111111-1111-4111-8111-111111111111", "runtimeLabel": "Preview Codex",
            "runtimeState": ["schemaVersion": 2, "epoch": "test", "revision": 1, "state": working ? "active" : "idle",
                             "phase": working ? "running" : "idle",
                             "actions": ["send": true, "cancel": working, "reply": false, "steer": working]],
            "activitySeq": 2, "readSeq": 2,
        ]
        if let parent { row["parentSessionId"] = parent }
        if let avatar { row["avatar"] = avatar }
        if let question {
            row["inputRequests"] = [["id": "q-\(id)", "question": question, "options": ["Yes", "No"], "askedAt": "2026-11-03T\(time):00Z"]]
        }
        return row
    }

    private static func teammates(_ row: [String: Any], canArchive: Bool) -> [String: Any] {
        row.merging(["isOwner": false, "canManage": false, "canArchive": canArchive, "watching": false]) { $1 }
    }

    private static func face(_ id: String, _ name: String, _ avatar: String) -> [String: Any] {
        ["id": id, "name": name, "agent": ["avatar": avatar, "provider": "claude-code"]]
    }

    private static func chat(_ id: String, _ title: String, at time: String, faces: [[String: Any]], group: Bool = false, agents: [String]? = nil) -> [String: Any] {
        var chat: [String: Any] = [
            "sessionId": id, "teamId": team, "kind": "channel", "title": title, "firstMessage": "", "messageCount": 3,
            "createdAt": "2026-11-02T08:00:00Z", "lastActiveAt": "2026-11-03T\(time):00Z",
            "isOwner": true, "readOnly": false, "activitySeq": 3, "readSeq": 3, "faces": faces,
            "agentSessionIds": agents ?? faces.compactMap { $0["agent"] == nil ? nil : $0["id"] as? String },
            "lastMessage": ["text": "On it.", "from": (faces.last?["name"] as? String) ?? ""],
        ]
        if group { chat["group"] = true }
        return chat
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
