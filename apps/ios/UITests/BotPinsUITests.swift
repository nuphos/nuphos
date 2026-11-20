import XCTest

final class BotPinsUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testPinnedShelfAndUnpinKeepConversationInRecentList() throws {
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        let team = "64b5f1c2e4b0a1d2c3e4f5a6"
        var channels = try XCTUnwrap(responses["GET /agent/conversations?kind=channel"] as? [String: Any])
        var body = try XCTUnwrap(channels["body"] as? [String: Any])
        var rows = try XCTUnwrap(body["conversations"] as? [[String: Any]])
        rows[0]["lastMessage"] = ["text": "The release checklist is ready. Please review the API changes before we ship."]
        body["conversations"] = rows
        channels["body"] = body
        responses["GET /agent/conversations?kind=channel"] = channels
        let favorites: [String: Any] = ["entries": [["label": "Release ops", "href": "/teams/\(team)/agent/chat-release"]], "revision": 1]
        responses["GET /teams/\(team)/favorites"] = ["status": 200, "body": favorites]
        responses["PUT /teams/\(team)/favorites"] = ["status": 200, "body": favorites]
        let live = URL.temporaryDirectory.appending(path: "bot-pins-\(UUID()).json")
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
        defer { try? FileManager.default.removeItem(at: live) }
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let shelf = app.scrollViews["PinnedBotsShelf"]
        XCTAssertTrue(shelf.waitForExistence(timeout: 15))
        let pin = shelf.buttons.firstMatch
        XCTAssertTrue(pin.exists)
        XCTAssertFalse(pin.label.isEmpty, "VoiceOver needs the pinned conversation title")
        pin.press(forDuration: 1)
        let unpin = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Unpin'")).firstMatch
        XCTAssertTrue(unpin.waitForExistence(timeout: 5))
        shot("bot-pin-preview")
        unpin.tap()
        // Later polls must observe the unpin, as a real server would.
        responses["GET /teams/\(team)/favorites"] = ["status": 200, "body": ["entries": [], "revision": 2]]
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
        XCTAssertTrue(shelf.waitForNonExistence(timeout: 3))
        let row = app.staticTexts["design-review"].firstMatch
        XCTAssertTrue(row.exists)
        row.press(forDuration: 1)
        // This fixture row is an ordinary channel, with no botId.
        XCTAssertNil(rows[1]["botId"])
        let pinAction = app.buttons["Pin"].firstMatch
        XCTAssertTrue(pinAction.waitForExistence(timeout: 5))
        shot("bot-row-preview")
        pinAction.tap()
        XCTAssertTrue(shelf.waitForExistence(timeout: 5))
    }
    func testLongPressingSecondPinUsesItsOwnConversation() throws {
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        let team = "64b5f1c2e4b0a1d2c3e4f5a6"
        let favorites: [String: Any] = ["entries": [
            ["label": "Release", "href": "/teams/\(team)/agent/chat-release"],
            ["label": "Design", "href": "/teams/\(team)/agent/chat-design"],
        ], "revision": 1]
        responses["GET /teams/\(team)/favorites"] = ["status": 200, "body": favorites]
        responses["PUT /teams/\(team)/favorites"] = ["status": 200, "body": favorites]
        let live = URL.temporaryDirectory.appending(path: "bot-pins-two-\(UUID()).json")
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
        defer { try? FileManager.default.removeItem(at: live) }
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let first = app.buttons["PinnedBot-chat-release"]
        let second = app.buttons["PinnedBot-chat-design"]
        XCTAssertTrue(second.waitForExistence(timeout: 15))
        first.press(forDuration: 1)
        XCTAssertTrue(app.buttons["Unpin"].waitForExistence(timeout: 5))
        shot("first-pin-menu")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.75)).tap()
        XCTAssertTrue(app.buttons["Unpin"].waitForNonExistence(timeout: 5))
        second.press(forDuration: 1)
        XCTAssertTrue(app.buttons["Unpin"].waitForExistence(timeout: 5))
        shot("second-pin-menu")
        app.buttons["Unpin"].tap()
        XCTAssertTrue(second.waitForNonExistence(timeout: 5), "Unpin targeted the wrong Bot")
        XCTAssertTrue(first.exists, "Unpinning the second Bot removed the first")
    }


    /// A Bot's owner reaches its Task, runtime and model from the chat's header in one tap,
    /// as before Bot details (#3873 left them only behind the Bot's name).
    func testBotChatHeaderOpensTheBotsTaskWithRuntimeAndModel() throws {
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appending(path: "tests/fixtures/bot-desktop-responses.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        var detail = try XCTUnwrap(responses["GET /agent/conversations/chat-bot-plain"] as? [String: Any])
        var body = try XCTUnwrap(detail["body"] as? [String: Any])
        body["botId"] = "bot-plain"
        detail["body"] = body
        responses["GET /agent/conversations/chat-bot-plain"] = detail
        let listing = responses["GET /agent/conversations"] as! [String: Any]
        var task = ((listing["body"] as! [String: Any])["conversations"] as! [[String: Any]])[1]
        task["messages"] = body["messages"]; task["messagesFirstIndex"] = 0; task["readOnly"] = false
        responses["GET /agent/conversations/bot-plain"] = ["status": 200, "body": task]
        responses["GET /agent/conversations/bot-plain/model-config"] = ["status": 200, "body": [
            "status": "ready",
            "options": [["id": "model", "name": "Model", "kind": "model", "currentValue": "sonnet",
                         "options": [["value": "sonnet", "name": "Sonnet"], ["value": "opus", "name": "Opus"]]]],
        ]]
        let live = URL.temporaryDirectory.appending(path: "bot-header-task-\(UUID()).json")
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
        defer { try? FileManager.default.removeItem(at: live) }
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let row = app.staticTexts["Release notes"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10)); row.tap()
        let entry = app.navigationBars.buttons["chat.botTask"]
        XCTAssertTrue(entry.waitForExistence(timeout: 10), "The Bot chat's header has no Task button")
        shot("bot-header-task")
        entry.tap()
        XCTAssertTrue(app.buttons["agent-summary-button"].waitForExistence(timeout: 10), "The header's Task button did not open the Bot's Task")
        let input = app.textViews.firstMatch.exists ? app.textViews.firstMatch : app.textFields.firstMatch
        input.tap()
        let runtime = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Switch runtime'")).firstMatch
        XCTAssertTrue(runtime.waitForExistence(timeout: 10), "The Bot's Task offers no runtime switch")
        XCTAssertTrue(app.buttons["Model settings"].waitForExistence(timeout: 10), "The Bot's Task shows no model")
        shot("bot-task-runtime-model")
        runtime.tap()
        XCTAssertTrue(app.navigationBars["Choose runtime"].waitForExistence(timeout: 10), "Switch runtime opened nothing")
        shot("bot-task-runtime-picker")
    }

    func testBotTaskReturnsToItsChat() throws {
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appending(path: "tests/fixtures/bot-desktop-responses.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        var detail = try XCTUnwrap(responses["GET /agent/conversations/chat-bot-plain"] as? [String: Any])
        var body = try XCTUnwrap(detail["body"] as? [String: Any])
        body["botId"] = "bot-plain"
        detail["body"] = body
        responses["GET /agent/conversations/chat-bot-plain"] = detail
        let listing = responses["GET /agent/conversations"] as! [String: Any]
        let bot = ((listing["body"] as! [String: Any])["conversations"] as! [[String: Any]])[1]
        var task = bot
        task["messages"] = body["messages"]; task["messagesFirstIndex"] = 0; task["readOnly"] = false
        responses["GET /agent/conversations/bot-plain"] = ["status": 200, "body": task]
        let live = URL.temporaryDirectory.appending(path: "bot-task-\(UUID()).json")
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
        defer { try? FileManager.default.removeItem(at: live) }
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let row = app.staticTexts["Release notes"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10)); row.tap()
        // The Bot's own Task opens from its details, under its name (#2983).
        let name = app.buttons["bot-details-entry"]
        XCTAssertTrue(name.waitForExistence(timeout: 10)); name.tap()
        let entry = app.buttons["bot-task-entry"]
        XCTAssertTrue(entry.waitForExistence(timeout: 10)); shot("bot-chat-task-entry"); entry.tap()
        XCTAssertTrue(app.buttons["conversation-trigger-entry"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Task options"].waitForExistence(timeout: 10))
        app.buttons["Task options"].tap()
        shot("bot-task-options")
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "Work tools").firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "Share").firstMatch.exists)
        app.descendants(matching: .any).matching(identifier: "Rename").firstMatch.tap()
        XCTAssertTrue(app.alerts["Rename task"].waitForExistence(timeout: 5))
        app.alerts["Rename task"].buttons["Cancel"].tap()
        app.buttons["agent-summary-button"].tap()
        XCTAssertTrue(app.buttons["Close summary"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Archive"].exists, "Bot summary must not bypass archive confirmation")
        shot("bot-own-task")
        app.buttons["Close summary"].tap()
        app.buttons["Task options"].tap()
        app.descendants(matching: .any).matching(identifier: "Archive").firstMatch.tap()
        XCTAssertTrue(app.alerts["This is a Bot. Archive the Bot?"].waitForExistence(timeout: 5))
        app.alerts.buttons["Cancel"].tap()
        app.buttons["BackButton"].firstMatch.tap()
        XCTAssertTrue(name.waitForExistence(timeout: 5), "Back must return to the Bot chat, not its list")
        shot("bot-task-returned-to-chat")
        if app.windows.firstMatch.horizontalSizeClass == .regular {
            XCTAssertTrue(app.buttons["Account"].isHittable)
            XCTAssertTrue(app.buttons["Computers & runtimes"].isHittable)
            XCTAssertTrue(app.buttons["Create"].isHittable)
            app.buttons["Account"].tap()
            XCTAssertTrue(app.buttons["Close account"].waitForExistence(timeout: 5))
            app.buttons["Close account"].tap()
            name.tap()
            XCTAssertTrue(entry.waitForExistence(timeout: 5)); entry.tap()
            XCTAssertTrue(app.buttons["agent-summary-button"].waitForExistence(timeout: 5))
            app.staticTexts["Sign-in helper"].firstMatch.tap()
            let header = app.buttons["bot-details-entry"]
            let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "Sign-in helper"), object: header)
            XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 5), .completed)
            XCTAssertTrue(app.buttons["agent-summary-button"].waitForNonExistence(timeout: 5), "Selecting another chat must pop the previous Bot Task")
            shot("bot-task-selection-reset")
        }
    }

    private func shot(_ name: String) {
        let screen = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screen)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["NUPHOS_SHOTS"] {
            try? screen.pngRepresentation.write(to: URL(filePath: dir).appending(path: "\(name).png"))
        }
    }
}
