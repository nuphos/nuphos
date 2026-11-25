import XCTest

/// Offline UI coverage; the real-backend runtime/model flow is verified separately.
final class BotDetailsRuntimeUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func launch(owner: Bool, botReadDelayMs: Int? = nil) throws -> XCUIApplication {
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
        var botRead: [String: Any] = ["status": 200, "body": bot]
        botRead["delayMs"] = botReadDelayMs
        responses["GET /agent/conversations/bot-plain"] = botRead
        responses["GET /agent/conversations/chat-bot-plain/agents"] = ["status": 200, "body": ["agents": [[
            "sessionId": "bot-plain", "title": "Release notes",
            "ownerId": owner ? "507f1f77bcf86cd799439011" : "someone-else",
        ]]]]
        responses["GET /agent/conversations/bot-plain/model-config"] = ["status": 200, "body": [
            "status": "ready",
            "options": [["id": "model", "name": "Model", "kind": "model", "currentValue": "sonnet",
                         "options": [["value": "sonnet", "name": "Sonnet"], ["value": "opus", "name": "Opus"]]]],
        ]]
        let live = URL.temporaryDirectory.appending(path: "bot-details-runtime-\(UUID()).json")
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

    /// The Bot's runtime and model are picked in its details, not its chat's composer.
    private func openDetails(_ app: XCUIApplication) {
        let entry = app.buttons["bot-details-entry"]
        XCTAssertTrue(entry.waitForExistence(timeout: 15)); entry.tap()
        XCTAssertTrue(app.descendants(matching: .any)["bot-details-runtime"].waitForExistence(timeout: 15))
    }

    func testOwnerPicksModelInBotDetails() throws {
        let app = try launch(owner: true)
        XCTAssertTrue(app.buttons["bot-details-entry"].waitForExistence(timeout: 15))
        shot("bot-details-ios-chat")
        openDetails(app)
        let runtime = app.buttons["bot-details-runtime"]
        let model = app.buttons["bot-details-model"]
        XCTAssertTrue(runtime.exists)
        XCTAssertTrue(model.waitForExistence(timeout: 10))
        XCTAssertLessThan(runtime.frame.minY, model.frame.minY)
        shot("bot-details-ios-owner")
        model.tap()
        XCTAssertTrue(app.buttons["Opus"].waitForExistence(timeout: 10), "The Bot's model choices did not load")
        XCTAssertTrue(app.buttons["Opus"].isEnabled)
        shot("bot-details-ios-model")
    }

    func testNonOwnerSeesRuntimeAndModelReadOnly() throws {
        let app = try launch(owner: false)
        openDetails(app)
        XCTAssertFalse(app.buttons["bot-details-runtime"].exists, "Only the owner can move the Bot")
        let model = app.buttons["bot-details-model"]
        XCTAssertTrue(model.waitForExistence(timeout: 10))
        shot("bot-details-ios-member")
        model.tap()
        XCTAssertTrue(app.staticTexts["Only the owner can change model settings."].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Opus"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Opus"].isEnabled)
        shot("bot-details-ios-member-model")
    }

    /// A Bot whose own read is slow still shows what it runs, and its model once the read lands.
    func testRuntimeShowsWhileBotLoads() throws {
        let app = try launch(owner: true, botReadDelayMs: 8000)
        openDetails(app)
        let labels = app.descendants(matching: .any).matching(identifier: "bot-details-runtime")
            .allElementsBoundByIndex.map(\.label).joined(separator: " ")
        XCTAssertFalse(labels.contains("Choose runtime"), "The runtime read as unset: \(labels)")
        XCTAssertTrue(labels.contains("Preview Box"), "The Bot's runtime is missing: \(labels)")
        shot("bot-details-ios-loading")
        let model = app.buttons["bot-details-model"]
        let picked = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS 'Sonnet'"), object: model)
        XCTAssertEqual(XCTWaiter().wait(for: [picked], timeout: 30), .completed, "The Bot's model never showed: \(model.label)")
        XCTAssertTrue(app.buttons["bot-details-runtime"].exists, "The owner cannot move the Bot once it has loaded")
        shot("bot-details-ios-loaded")
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
