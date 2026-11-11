import XCTest

/// Offline copies only. Capture actual list/header/empty-chat ancestors; never send a push.
final class BotRuntimeAvatarUITests: XCTestCase {
    private var live: URL?

    override func tearDown() {
        if let live { try? FileManager.default.removeItem(at: live) }
    }

    private func bot(_ id: String, _ provider: String?) -> [String: Any] {
        var identity: [String: Any] = ["avatar": id == "bot-plain" ? "02-leonardo" : "07-ada"]
        if let provider { identity["provider"] = provider }
        return ["id": id, "name": id, "agent": identity]
    }
    private let person: [String: Any] = ["id": "synthetic-human", "name": "Human"]

    func testRearBotAndHuman() throws { try captureCase("rear-bot", faces: [person, bot("bot-plain", "codex")]) }
    func testFrontBotAndHuman() throws { try captureCase("front-bot", faces: [bot("bot-plain", "codex"), person]) }
    func testTwoBotsHaveTheirOwnProviders() throws { try captureCase("two-bots", faces: [bot("bot-plain", "codex"), bot("second-bot", "grok")]) }
    func testAllHumanGroup() throws { try captureCase("all-human", faces: [person, ["id": "other-human", "name": "Other"]]) }
    func testBotWithMissingRuntime() throws { try captureCase("missing-runtime", faces: [bot("bot-plain", nil)]) }

    func testTypingUsesTheActualBotProvider() throws { try captureCase("typing-codex", faces: [bot("bot-plain", "codex")], typing: true) }

    private func captureCase(_ name: String, faces: [[String: Any]], typing: Bool = false) throws {
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/bot-desktop-responses.json")
        let file = fixture.deletingLastPathComponent().appending(path: "avatar-live-\(UUID().uuidString).json")
        live = file
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        let listKey = "GET /agent/conversations?kind=channel"
        var listing = try XCTUnwrap(responses[listKey] as? [String: Any])
        var body = try XCTUnwrap(listing["body"] as? [String: Any])
        var rows = try XCTUnwrap(body["conversations"] as? [[String: Any]])
        let index = try XCTUnwrap(rows.firstIndex { $0["sessionId"] as? String == "chat-bot-plain" })
        rows[index]["faces"] = faces
        body["conversations"] = rows
        listing["body"] = body
        responses[listKey] = listing
        let detailKey = "GET /agent/conversations/chat-bot-plain"
        var detail = try XCTUnwrap(responses[detailKey] as? [String: Any])
        var chat = try XCTUnwrap(detail["body"] as? [String: Any])
        chat["faces"] = faces
        if var messages = chat["messages"] as? [[String: Any]] {
            for i in messages.indices {
                guard var metadata = messages[i]["metadata"] as? [String: Any],
                      var sender = metadata["sender"] as? [String: Any], sender["type"] as? String == "agent" else { continue }
                sender["agentRuntime"] = "codex"
                metadata["sender"] = sender
                messages[i]["metadata"] = metadata
            }
            chat["messages"] = messages
        }
        if typing {
            let agentsKey = "GET /agent/conversations/chat-bot-plain/agents"
            responses[agentsKey] = ["status": 200, "body": ["agents": [["sessionId": "bot-plain", "title": "Release notes", "ownerId": "507f1f77bcf86cd799439011", "provider": "codex"]]]]
            let sessionsKey = "GET /agent/conversations"
            var entry = try XCTUnwrap(responses[sessionsKey] as? [String: Any])
            var list = try XCTUnwrap(entry["body"] as? [String: Any])
            var sessions = try XCTUnwrap(list["conversations"] as? [[String: Any]])
            let botIndex = try XCTUnwrap(sessions.firstIndex { $0["sessionId"] as? String == "bot-plain" })
            sessions[botIndex]["agentRuntime"] = "codex"
            sessions[botIndex]["runtimeState"] = ["schemaVersion": 2, "epoch": "avatar-fixture", "revision": 1, "state": "active", "phase": "working", "channelIds": ["chat-bot-plain"]]
            list["conversations"] = sessions
            entry["body"] = list
            responses[sessionsKey] = entry
        }
        detail["body"] = chat
        responses[detailKey] = detail
        try JSONSerialization.data(withJSONObject: responses).write(to: file, options: .atomic)
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": file.path]
        app.launch()
        let row = app.staticTexts["Release notes"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        shot(name + "-list-36")
        row.tap()
        XCTAssertTrue(app.collectionViews["chat.transcript"].waitForExistence(timeout: 10))
        if typing {
            XCTAssertTrue(app.otherElements["Release notes is thinking"].firstMatch.waitForExistence(timeout: 10))
        }
        shot(name + "-header-24-and-messages")
        app.terminate()
        // Only this private copy changes; shared fixture keys/Bot names/personas stay untouched.
        chat["messages"] = []
        chat["messageCount"] = 0
        detail["body"] = chat
        responses[detailKey] = detail
        try JSONSerialization.data(withJSONObject: responses).write(to: file, options: .atomic)
        app.launch()
        XCTAssertTrue(app.staticTexts["Release notes"].firstMatch.waitForExistence(timeout: 10))
        app.staticTexts["Release notes"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Everyone here sees each message and decides for themselves whether to reply, as in any group chat."].waitForExistence(timeout: 10))
        shot(name + "-empty-chat-44")
        app.terminate()
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
