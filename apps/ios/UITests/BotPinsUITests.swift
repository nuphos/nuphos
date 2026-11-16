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
        pin.press(forDuration: 1)
        let unpin = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Unpin'")).firstMatch
        XCTAssertTrue(unpin.waitForExistence(timeout: 5))
        shot("bot-pin-preview")
        unpin.tap()
        XCTAssertTrue(shelf.waitForNonExistence(timeout: 3))
        let row = app.staticTexts["design-review"].firstMatch
        XCTAssertTrue(row.exists)
        row.press(forDuration: 1)
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
