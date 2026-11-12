import XCTest

/// Synthetic offline chat posts; no provider or customer account is used.
final class ChannelMessageMenuUITests: XCTestCase {
    private let message = "Select this passage from a longer message.\n\nThe rest of this reply should stay outside the copied selection."

    func testBubbleMenuAndPartialCopy() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        var detail = try XCTUnwrap(responses["GET /agent/conversations/chat-release"] as? [String: Any])
        var body = try XCTUnwrap(detail["body"] as? [String: Any])
        body["messages"] = [post("first", text: "An earlier synthetic reply."), post("message", text: message)]
        body["messageCount"] = 2
        body["timelineEvents"] = []
        detail["body"] = body
        responses["GET /agent/conversations/chat-release"] = detail
        let live = FileManager.default.temporaryDirectory.appending(path: "bubble-menu-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: live) }
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent", "-open-links",
            "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/chat-release"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let cell = app.collectionViews["chat.transcript"].cells.element(boundBy: 2)
        XCTAssertTrue(cell.waitForExistence(timeout: 15))
        shot(app, "bubble")
        cell.press(forDuration: 1)
        XCTAssertTrue(app.buttons["Reply"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Copy"].exists)
        if app.buttons["Continue"].exists {
            app.buttons["Continue"].tap()
            cell.press(forDuration: 1)
            XCTAssertTrue(app.buttons["Reply"].waitForExistence(timeout: 5))
        }
        shot(app, "context-menu")
        if ProcessInfo.processInfo.environment["NUPHOS_EVIDENCE_BASELINE"] == "1" { return }
        app.buttons["Select Text"].tap()
        let copy = app.menuItems["Copy"].firstMatch
        XCTAssertTrue(copy.waitForExistence(timeout: 5))
        shot(app, "partial-selection")
        copy.tap()
        let composer = try XCTUnwrap([app.textFields.firstMatch, app.textViews.firstMatch].first { $0.exists })
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.press(forDuration: 1)
        let paste = app.menuItems["Paste"].firstMatch
        XCTAssertTrue(paste.waitForExistence(timeout: 5))
        paste.tap()
        XCTAssertEqual(composer.value as? String, "Select", "Only the selected word should be copied")
        shot(app, "partial-copy")
    }

    private func post(_ id: String, text: String) -> [String: Any] {
        ["id": id, "role": "user", "parts": [["type": "text", "text": text]],
         "metadata": ["version": 1, "sender": ["type": "agent", "id": "agent-ops", "displayName": "Preview Bot"],
                      "sentAt": "2026-11-03T09:23:00.000Z", "sourceSessionId": "agent-ops"],
         "createdAt": "2026-11-03T09:23:00.000Z"]
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
