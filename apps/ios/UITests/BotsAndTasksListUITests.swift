import XCTest

/// Bots and Tasks list what the Desktop sidebar lists (#2703): a Bot's chat
/// is named after the Bot and carries what the Bot dispatched, which Tasks
/// leaves out. Uses a copy of the offline chats fixture with its own rows.
final class BotsAndTasksListUITests: XCTestCase {
    static let team = "64b5f1c2e4b0a1d2c3e4f5a6"
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
            // What the Bots dispatched, at any depth: listed under Bots, never in Tasks.
            Self.row("agent-ci", "Check the CI flake", at: "09:45", parent: "bot-lead", question: "Retry the flaky iOS job?"),
            Self.row("agent-rerun", "Rerun the iOS job", at: "09:46", parent: "agent-ci", working: true),
            Self.row("agent-links", "Fix broken links", at: "09:44", parent: "bot-docs", working: true),
            Self.row("agent-logs", "Collect crash logs", at: "09:21", parent: "bot-helper", unread: true),
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
        XCTAssertTrue(app.descendants(matching: .any)["Docs Bot is thinking"].exists, "A dispatched turn does not show on the Bot's chat")
        XCTAssertTrue(app.staticTexts["New Group Chat"].exists, "An untitled group chat is not named as one")
        XCTAssertFalse(app.staticTexts["Triage Bot"].exists, "A Bot in a chat still has a row of its own")
        XCTAssertTrue(app.staticTexts["Helper Bot"].exists, "A Bot opened by a Task is not listed as a Bot")

        // Folded at rest: a Bot's threads show only once opened by hand.
        XCTAssertFalse(app.staticTexts["Check the CI flake"].exists, "A Bot's threads are open at rest")
        shot("1-bots")
        app.buttons["Show 2 sub-agents"].firstMatch.tap()
        for _ in 0..<4 where app.buttons["Show 1 sub-agents"].firstMatch.exists {
            app.buttons["Show 1 sub-agents"].firstMatch.tap()
        }

        // What each Bot dispatched, nested under it, deeper threads under theirs.
        for (thread, below) in [("Check the CI flake", lead), ("Fix broken links", app.staticTexts["Docs Bot"].firstMatch),
                                ("Collect crash logs", app.staticTexts["Helper Bot"].firstMatch)] {
            let row = app.staticTexts[thread].firstMatch
            XCTAssertTrue(row.exists, "\(thread) is not under its Bot")
            XCTAssertGreaterThan(row.frame.minY, below.frame.minY)
            XCTAssertGreaterThan(row.frame.minX, below.frame.minX, "\(thread) is not nested")
        }
        let rerun = app.staticTexts["Rerun the iOS job"].firstMatch
        XCTAssertGreaterThan(rerun.frame.minX, app.staticTexts["Check the CI flake"].firstMatch.frame.minX, "A deeper thread lost its parent")
        shot("2-bots-opened")
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

    private func launch(page: String) {
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", page]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
    }

    static func row(
        _ id: String, _ title: String, at time: String, parent: String? = nil, avatar: String? = nil,
        question: String? = nil, working: Bool = false, workspace: String? = nil, unread: Bool = false
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
        if let workspace { row["workspace"] = ["kind": "folder", "path": workspace, "runtimeId": "11111111-1111-4111-8111-111111111111"] }
        if unread { row["readSeq"] = 1 }
        if let avatar { row["avatar"] = avatar }
        if let question {
            row["inputRequests"] = [["id": "q-\(id)", "question": question, "options": ["Yes", "No"], "askedAt": "2026-11-03T\(time):00Z"]]
        }
        return row
    }

    static func face(_ id: String, _ name: String, _ avatar: String) -> [String: Any] {
        ["id": id, "name": name, "agent": ["avatar": avatar, "provider": "claude-code"]]
    }

    static func chat(_ id: String, _ title: String, at time: String, faces: [[String: Any]], group: Bool = false, agents: [String]? = nil) -> [String: Any] {
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

    static func page(_ rows: [[String: Any]]) -> [String: Any] {
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
