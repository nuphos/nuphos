import XCTest

/// A chat with no posts yet shows its icon, name and a line about it. All of
/// that sits below the navigation bar and above the composer, with the back
/// button in reach: for a group, for a Bot's 1:1 chat with a long name, and
/// for the chat "Make this a Bot" opens. Uses a copy of the offline Bots
/// fixture, rewritten while the app runs.
final class EmptyChatUITests: XCTestCase {
    private static let team = "64b5f1c2e4b0a1d2c3e4f5a6"
    private static let long = "I want to make a 60s launch video for X, the theme is Introducing the agent workspace for teams"
    private var live: URL!
    private var responses: [String: Any] = [:]
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/bot-desktop-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "empty-chat-live-\(UUID().uuidString).json")
        responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        // A Task named by its first message, a group, and a Bot's chat with a long name: no posts in any.
        try edit("GET /agent/conversations") { $0.append(Self.task(avatar: nil)) }
        try edit("GET /agent/conversations?kind=channel") {
            $0.append(Self.chat("chat-group", title: "design-review", faces: []))
            $0.append(Self.chat("chat-long", title: Self.long, faces: [Self.face("bot-plain")]))
        }
        serve(chat: "chat-group", title: "design-review", agent: nil)
        serve(chat: "chat-long", title: Self.long, agent: "bot-plain")
        // "Make this a Bot" waits long enough for the test to put the Bot and its chat in the listings.
        responses["POST /agent/conversations/task-long/bot"] = ["status": 200, "body": [:], "delayMs": 1500]
        serve(chat: "chat-made", title: Self.long, agent: "task-long")
        responses["POST /agent/channels"] = ["status": 200, "body": ["sessionId": "chat-made"]]
        responses["POST /agent/conversations/chat-made/agents"] = ["status": 200, "body": [:]]
        try write()
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testEmptyGroupSitsBelowTheBar() throws {
        launch(page: "chats")
        try openAndReopen("design-review", shot: "group")
    }

    func testEmptyBotChatWithALongNameSitsBelowTheBar() throws {
        launch(page: "chats")
        try openAndReopen(Self.long, shot: "bot-long")
    }

    func testMakeThisABotOpensItsChatBelowTheBar() throws {
        try makeABot()
        try expectEmptyChat(named: Self.long, shot: "made-a-bot")
        // Back returns to the list the Bot was made from.
        app.navigationBars.buttons["BackButton"].tap()
        XCTAssertTrue(app.buttons["Switch page"].firstMatch.waitForExistence(timeout: 5), "Back did not return to the list")
    }

    // With the keyboard up there is less room. A simulator with a hardware keyboard shows none: skipped, not passed.

    func testEmptyGroupFitsAboveTheKeyboard() throws {
        launch(page: "chats")
        app.staticTexts["design-review"].firstMatch.tap()
        try expectFitsWithKeyboard(shot: "group-keyboard")
    }

    func testEmptyBotChatWithALongNameFitsAboveTheKeyboard() throws {
        launch(page: "chats")
        app.staticTexts[Self.long].firstMatch.tap()
        try expectFitsWithKeyboard(shot: "bot-long-keyboard")
    }

    func testMadeBotChatFitsAboveTheKeyboard() throws {
        try makeABot()
        try expectFitsWithKeyboard(shot: "made-a-bot-keyboard")
    }

    /// A chat with posts has no placeholder.
    func testChatWithPostsShowsNoPlaceholder() {
        launch(page: "chats")
        app.staticTexts["Release notes"].firstMatch.tap()
        XCTAssertTrue(app.collectionViews["chat.transcript"].cells.firstMatch.waitForExistence(timeout: 10), "The chat did not load")
        XCTAssertFalse(app.otherElements["chat.empty"].exists)
        XCTAssertTrue(app.navigationBars.buttons["BackButton"].isHittable)
        shot("with-posts")
    }

    // MARK: - What an empty chat must look like

    /// Opened from the list, and again after going back.
    private func openAndReopen(_ title: String, shot name: String) throws {
        app.staticTexts[title].firstMatch.tap()
        try expectEmptyChat(named: title, shot: name)
        app.navigationBars.buttons["BackButton"].tap()
        app.staticTexts[title].firstMatch.tap()
        try expectEmptyChat(named: title, shot: "\(name)-reopened")
    }

    /// As reported: from the Task row's swipe actions. The long press menu holds the same ones.
    private func makeABot() throws {
        launch(page: "agent")
        let row = app.staticTexts[Self.long].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "The Task is not listed")
        row.swipeLeft()
        let make = app.buttons["Make this a Bot"].firstMatch
        if !make.waitForExistence(timeout: 3) { row.press(forDuration: 1) }
        XCTAssertTrue(make.waitForExistence(timeout: 5), "No Make this a Bot among the row's actions")
        make.tap()
        try edit("GET /agent/conversations") { $0 = $0.filter { $0["sessionId"] as? String != "task-long" } + [Self.task(avatar: "02-leonardo")] }
        try edit("GET /agent/conversations?kind=channel") { $0.append(Self.chat("chat-made", title: Self.long, faces: [Self.face("task-long")])) }
        try write()
    }

    private func expectEmptyChat(named title: String, shot name: String) throws {
        let empty = app.otherElements["chat.empty"]
        XCTAssertTrue(empty.waitForExistence(timeout: 10), "The empty chat did not open")
        XCTAssertTrue(empty.staticTexts[title].exists, "The empty chat does not show its name")
        shot(name)

        let bar = app.navigationBars.firstMatch
        let back = bar.buttons["BackButton"]
        XCTAssertTrue(back.isHittable, "No back button")
        XCTAssertGreaterThanOrEqual(empty.frame.minY, bar.frame.maxY, "The placeholder is under the navigation bar")
        // The bar's own title stops at the back button. The bar holds the title more than once.
        for heading in bar.staticTexts.matching(identifier: title).allElementsBoundByIndex {
            XCTAssertGreaterThanOrEqual(heading.frame.minX, back.frame.maxX, "The title covers the back button")
        }

        let composer = try composerField()
        XCTAssertTrue(composer.isHittable, "The composer is out of reach")
        XCTAssertLessThanOrEqual(empty.frame.maxY, composer.frame.minY, "The placeholder is under the composer")
    }

    private func expectFitsWithKeyboard(shot name: String) throws {
        let empty = app.otherElements["chat.empty"]
        XCTAssertTrue(empty.waitForExistence(timeout: 10), "The empty chat did not open")
        let composer = try composerField()
        composer.tap()
        try XCTSkipUnless(app.keyboards.firstMatch.waitForExistence(timeout: 3), "This simulator shows no software keyboard")
        shot(name)
        XCTAssertGreaterThanOrEqual(empty.frame.minY, app.navigationBars.firstMatch.frame.maxY, "The placeholder is under the navigation bar")
        XCTAssertLessThanOrEqual(empty.frame.maxY, composer.frame.minY, "The placeholder is under the composer")
    }

    private func composerField() throws -> XCUIElement {
        try XCTUnwrap([app.textFields.firstMatch, app.textViews.firstMatch].first { $0.exists }, "No composer")
    }

    // MARK: - Fixture

    private func launch(page: String) {
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", page]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
    }

    private static func task(avatar: String?) -> [String: Any] {
        var row: [String: Any] = [
            "sessionId": "task-long", "teamId": team, "title": "", "firstMessage": long,
            "messageCount": 2, "createdAt": "2026-11-08T08:00:00Z", "lastActiveAt": "2026-11-08T09:50:00Z",
            "isOwner": true, "readOnly": false, "agentRuntime": "claude-code",
        ]
        row["avatar"] = avatar
        return row
    }

    private static func face(_ bot: String) -> [String: Any] {
        ["id": bot, "name": long, "agent": ["avatar": "02-leonardo", "provider": "claude-code"]]
    }

    private static func chat(_ id: String, title: String, faces: [[String: Any]]) -> [String: Any] {
        ["sessionId": id, "teamId": team, "kind": "channel", "title": title, "firstMessage": "",
         "messageCount": 0, "createdAt": "2026-11-08T08:00:00Z", "lastActiveAt": "2026-11-08T09:45:00Z",
         "isOwner": true, "readOnly": false, "activitySeq": 0, "readSeq": 0, "faces": faces]
    }

    /// What opening `id` reads: the chat with no posts, and its agents.
    private func serve(chat id: String, title: String, agent: String?) {
        responses["GET /agent/conversations/\(id)"] = ["status": 200, "body": [
            "sessionId": id, "kind": "channel", "title": title, "messages": [], "messagesFirstIndex": 0,
            "messageCount": 0, "transcriptUpdatedAt": "2026-11-08T09:45:00.000Z", "isOwner": true,
            "canManage": true, "readOnly": false, "activitySeq": 0, "readSeq": 0, "timelineEvents": [],
        ] as [String: Any]]
        let agents = agent.map { [["sessionId": $0, "title": title, "ownerId": "507f1f77bcf86cd799439011"]] } ?? []
        responses["GET /agent/conversations/\(id)/agents"] = ["status": 200, "body": ["agents": agents]]
        responses["POST /agent/conversations/\(id)/read"] = ["status": 200, "body": ["activitySeq": 0, "readSeq": 0]]
    }

    private func edit(_ key: String, _ change: (inout [[String: Any]]) -> Void) throws {
        var entry = try XCTUnwrap(responses[key] as? [String: Any])
        var body = try XCTUnwrap(entry["body"] as? [String: Any])
        var rows = try XCTUnwrap(body["conversations"] as? [[String: Any]])
        change(&rows)
        body["conversations"] = rows
        entry["body"] = body
        responses[key] = entry
    }

    private func write() throws {
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
