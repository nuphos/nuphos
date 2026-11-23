import XCTest

/// A Bot whose computer is away says so before anyone posts to it: in its own chat and in a group chat.
final class BotPresenceUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private let offline: [String: Any] = ["state": "offline", "reason": "computer_offline"]

    private func launch(_ edit: (inout [String: Any]) throws -> Void, open title: String) throws -> XCUIApplication {
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/bot-desktop-responses.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        try edit(&responses)
        let live = URL.temporaryDirectory.appending(path: "bot-presence-\(UUID()).json")
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
        addTeardownBlock { try? FileManager.default.removeItem(at: live) }
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let row = app.staticTexts[title].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15)); row.tap()
        return app
    }

    func testBotChatSaysItsComputerIsOffline() throws {
        let app = try launch({ responses in
            var channel = try XCTUnwrap(responses["GET /agent/conversations/chat-bot-plain"] as? [String: Any])
            var body = try XCTUnwrap(channel["body"] as? [String: Any])
            body["botId"] = "bot-plain"
            channel["body"] = body
            responses["GET /agent/conversations/chat-bot-plain"] = channel
            responses["GET /agent/conversations/chat-bot-plain/agents"] = ["status": 200, "body": ["agents": [[
                "sessionId": "bot-plain", "title": "Release notes", "ownerId": "507f1f77bcf86cd799439011",
                "avatar": "02-leonardo", "provider": "claude-code", "presence": offline,
            ]]]]
        }, open: "Release notes")
        let strip = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "The computer running this runtime is offline")).firstMatch
        XCTAssertTrue(strip.waitForExistence(timeout: 15), "The offline Bot's chat did not say its computer is away")
        XCTAssertTrue(app.staticTexts["Offline"].exists, "The Bot's status line did not say Offline")
        shot("bot-presence-ios-bot-chat")
    }

    func testGroupChatNamesTheOfflineBotAndListsPresence() throws {
        let app = try launch({ responses in
            let id = "chat-bot-box"
            var listing = try XCTUnwrap(responses["GET /agent/conversations?kind=channel"] as? [String: Any])
            var listingBody = try XCTUnwrap(listing["body"] as? [String: Any])
            var rows = try XCTUnwrap(listingBody["conversations"] as? [[String: Any]])
            let index = try XCTUnwrap(rows.firstIndex { $0["sessionId"] as? String == id })
            rows[index]["title"] = "Launch planning"
            let faces: [[String: Any]] = [
                ["id": "scribe", "name": "Scribe", "agent": ["avatar": "07-ada", "provider": "claude-code"]],
                ["id": "atlas", "name": "Atlas", "agent": ["avatar": "02-leonardo", "provider": "claude-code"]],
            ]
            rows[index]["faces"] = faces
            listingBody["conversations"] = rows
            listing["body"] = listingBody
            responses["GET /agent/conversations?kind=channel"] = listing
            var channel = try XCTUnwrap(responses["GET /agent/conversations/\(id)"] as? [String: Any])
            var body = try XCTUnwrap(channel["body"] as? [String: Any])
            body["title"] = "Launch planning"
            body["group"] = true
            body["faces"] = faces
            channel["body"] = body
            responses["GET /agent/conversations/\(id)"] = channel
            responses["GET /agent/conversations/\(id)/agents"] = ["status": 200, "body": ["agents": [
                ["sessionId": "scribe", "title": "Scribe", "ownerId": "someone-else", "avatar": "07-ada",
                 "provider": "claude-code", "presence": offline],
                ["sessionId": "atlas", "title": "Atlas", "ownerId": "someone-else", "avatar": "02-leonardo",
                 "provider": "claude-code", "presence": ["state": "online"]],
            ]]]
        }, open: "Launch planning")
        XCTAssertTrue(app.staticTexts["Scribe’s computer is offline."].waitForExistence(timeout: 15),
                      "The group chat did not name the Bot whose computer is away")
        shot("bot-presence-ios-group-chat")
        app.buttons["bot-details-entry"].tap()
        let scribe = app.descendants(matching: .any)["channel.bot.scribe"]
        XCTAssertTrue(scribe.waitForExistence(timeout: 10), "The group chat's Bots did not open")
        XCTAssertTrue(scribe.label.contains("Offline"), scribe.label)
        XCTAssertTrue(app.descendants(matching: .any)["channel.bot.atlas"].label.contains("Online"))
        shot("bot-presence-ios-group-bots")
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
