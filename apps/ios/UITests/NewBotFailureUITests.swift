import XCTest

/// A Bot or its first chat that fails to be made is reported where it was
/// asked for, and trying again opens the chat (#1738). Uses a copy of the
/// offline Bots fixture, rewritten while the app runs.
final class NewBotFailureUITests: XCTestCase {
    private static let team = "64b5f1c2e4b0a1d2c3e4f5a6"
    private var live: URL!
    private var responses: [String: Any] = [:]
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "new-bot-live-\(UUID().uuidString).json")
        responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        responses["GET /teams/\(Self.team)/agent-runtimes"] = ["status": 200, "body": ["runtimes": [[
            "id": "11111111-1111-4111-8111-111111111111", "provider": "claude-code", "label": "Preview Claude",
            "status": "active", "kind": "managed",
        ]]]]
        responses["GET /agent/conversations?bots=true"] = Self.listing([])
        serve(chat: "chat-atlas", title: "Atlas")
        try write()
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    /// A: a Bot with no 1:1 chat yet. Making the chat fails, then works.
    func testOpeningABotWhoseChatFailsReportsItAndRetryOpensIt() throws {
        responses["GET /agent/conversations?bots=true"] = Self.listing([Self.bot("bot-atlas", title: "Atlas")])
        fail("POST /agent/channels")
        try write()
        launch()
        let row = app.staticTexts["Atlas"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "No alert after the chat failed to be made")
        shot("a-failed")
        XCTAssertTrue(app.buttons["Switch page"].firstMatch.exists, "The list is no longer on screen")

        try madeChat()
        alert.buttons["Try again"].tap()
        try expectChat("Atlas")
    }

    /// B and C: New Bot fails, stays open with the name, then Create works and opens the chat.
    func testNewBotThatFailsStaysOpenAndRetryOpensTheChat() throws {
        fail("POST /agent/bots")
        try write()
        launch()
        let plus = app.buttons["New Bot"].firstMatch
        XCTAssertTrue(plus.waitForExistence(timeout: 10))
        XCTAssertTrue(plus.wait(for: \.isEnabled, toEqual: true, timeout: 10))
        plus.tap()
        let name = app.textFields["Name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.typeText("Atlas")
        app.buttons["Create"].tap()
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "No alert after creating failed")
        shot("b-failed")
        alert.buttons.firstMatch.tap()
        XCTAssertTrue(app.navigationBars["New Bot"].waitForExistence(timeout: 3), "The New Bot sheet closed")
        XCTAssertEqual(name.value as? String, "Atlas", "The name was lost")

        responses["POST /agent/bots"] = ["status": 200, "body": ["sessionId": "bot-atlas"]]
        responses["GET /agent/conversations?bots=true"] = Self.listing([Self.bot("bot-atlas", title: "Atlas")])
        try madeChat()
        app.buttons["Create"].tap()
        try expectChat("Atlas")
    }

    // MARK: - Fixture

    private func launch() {
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
    }

    private func expectChat(_ title: String) throws {
        // The new chat has no posts, so it shows its empty state.
        let chat = app.otherElements["chat.empty"]
        let opened = chat.waitForExistence(timeout: 10)
        shot("chat")
        XCTAssertTrue(opened, "The chat did not open")
        XCTAssertTrue(chat.staticTexts[title].exists, "Another chat opened")
    }

    /// The chat `POST /agent/channels` makes, with the Bot in it, listed from then on.
    private func madeChat() throws {
        responses["POST /agent/channels"] = ["status": 200, "body": ["sessionId": "chat-atlas"]]
        responses["POST /agent/conversations/chat-atlas/agents"] = ["status": 200, "body": [:]]
        try edit("GET /agent/conversations?kind=channel") { rows in
            rows.append(["sessionId": "chat-atlas", "teamId": Self.team, "kind": "channel", "title": "Atlas", "firstMessage": "",
                         "messageCount": 0, "createdAt": "2026-11-08T08:00:00Z", "lastActiveAt": "2026-11-08T09:59:00Z",
                         "isOwner": true, "readOnly": false, "activitySeq": 0, "readSeq": 0,
                         "faces": [["id": "bot-atlas", "name": "Atlas", "agent": ["avatar": "02-leonardo", "provider": "claude-code"]]]])
        }
        try write()
    }

    private static func listing(_ rows: [[String: Any]]) -> [String: Any] {
        ["status": 200, "body": ["conversations": rows, "nextCursor": NSNull(), "hasMore": false]]
    }

    private func fail(_ key: String) {
        responses[key] = ["status": 500, "delayMs": 800, "body": ["error": ["message": "Synthetic failure"]]]
    }

    private static func bot(_ id: String, title: String) -> [String: Any] {
        ["sessionId": id, "teamId": team, "title": title, "firstMessage": "", "messageCount": 0,
         "createdAt": "2026-11-08T08:00:00Z", "lastActiveAt": "2026-11-08T09:58:00Z",
         "isOwner": true, "readOnly": false, "agentRuntime": "claude-code", "avatar": "02-leonardo"]
    }

    private func serve(chat id: String, title: String) {
        responses["GET /agent/conversations/\(id)"] = ["status": 200, "body": [
            "sessionId": id, "kind": "channel", "title": title, "messages": [], "messagesFirstIndex": 0,
            "messageCount": 0, "transcriptUpdatedAt": "2026-11-08T09:45:00.000Z", "isOwner": true,
            "canManage": true, "readOnly": false, "activitySeq": 0, "readSeq": 0, "timelineEvents": [],
        ] as [String: Any]]
        responses["GET /agent/conversations/\(id)/agents"] = ["status": 200, "body": ["agents": [
            ["sessionId": "bot-atlas", "title": title, "ownerId": "507f1f77bcf86cd799439011"],
        ]]]
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
