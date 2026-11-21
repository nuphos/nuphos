import XCTest

/// Offline UI coverage; the real-backend runtime/model flow is verified separately.
final class BotComposerControlsUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func launch(owner: Bool) throws -> XCUIApplication {
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/bot-desktop-responses.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        var channel = try XCTUnwrap(responses["GET /agent/conversations/chat-bot-plain"] as? [String: Any])
        var channelBody = try XCTUnwrap(channel["body"] as? [String: Any])
        channelBody["botId"] = "bot-plain"
        channel["body"] = channelBody
        responses["GET /agent/conversations/chat-bot-plain"] = channel
        let listing = try XCTUnwrap(responses["GET /agent/conversations"] as? [String: Any])
        let listingBody = try XCTUnwrap(listing["body"] as? [String: Any])
        let rows = try XCTUnwrap(listingBody["conversations"] as? [[String: Any]])
        var bot = rows[1]
        bot["messages"] = channelBody["messages"]
        bot["messagesFirstIndex"] = 0
        bot["isOwner"] = owner
        bot["canManage"] = owner
        bot["readOnly"] = !owner
        responses["GET /agent/conversations/bot-plain"] = ["status": 200, "body": bot]
        responses["GET /agent/conversations/chat-bot-plain/agents"] = ["status": 200, "body": ["agents": [[
            "sessionId": "bot-plain", "title": "Release notes",
            "ownerId": owner ? "507f1f77bcf86cd799439011" : "someone-else",
        ]]]]
        responses["GET /agent/conversations/bot-plain/model-config"] = ["status": 200, "body": [
            "status": "ready",
            "options": [["id": "model", "name": "Model", "kind": "model", "currentValue": "sonnet",
                         "options": [["value": "sonnet", "name": "Sonnet"], ["value": "opus", "name": "Opus"]]]],
        ]]
        let live = URL.temporaryDirectory.appending(path: "bot-composer-\(UUID()).json")
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
        addTeardownBlock { try? FileManager.default.removeItem(at: live) }
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let row = app.staticTexts["Release notes"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15)); row.tap()
        return app
    }

    func testOwnerCanOpenBotModelSheet() throws {
        let app = try launch(owner: true)
        let runtime = app.buttons["bot-composer.runtime"]
        let model = app.buttons["bot-composer.model"]
        XCTAssertTrue(runtime.waitForExistence(timeout: 15))
        XCTAssertTrue(model.waitForExistence(timeout: 15))
        XCTAssertLessThan(runtime.frame.minX, model.frame.minX)
        shot("bot-composer-ios-owner")
        model.tap()
        XCTAssertTrue(app.navigationBars["Model"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Opus"].waitForExistence(timeout: 10), "The Bot's model choices did not load")
        shot("bot-composer-ios-model")
    }

    func testNonOwnerSeesLockedControlsAndHint() throws {
        let app = try launch(owner: false)
        let runtime = app.buttons["bot-composer.runtime"]
        let model = app.buttons["bot-composer.model"]
        XCTAssertTrue(runtime.waitForExistence(timeout: 15))
        XCTAssertTrue(model.waitForExistence(timeout: 15))
        model.tap()
        XCTAssertTrue(app.alerts["Only the owner can change model settings."].waitForExistence(timeout: 5))
        shot("bot-composer-ios-locked")
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
