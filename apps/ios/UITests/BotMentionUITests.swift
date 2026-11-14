import XCTest

/// In a Bot's 1:1 chat, `@` offers the viewer's other Bots, as a Task's composer
/// does, and picking one puts its link in the draft. Offline fixture.
final class BotMentionUITests: XCTestCase {
    func testAtOffersOtherBots() throws {
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/bot-desktop-responses.json")
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()

        app.staticTexts["Release notes"].firstMatch.tap()
        XCTAssertTrue(app.collectionViews["chat.transcript"].cells.firstMatch.waitForExistence(timeout: 10),
                      "The Bot's chat did not load")
        let composer = try XCTUnwrap([app.textFields.firstMatch, app.textViews.firstMatch].first { $0.exists })
        composer.tap()
        if app.buttons["Continue"].waitForExistence(timeout: 2) { app.buttons["Continue"].tap() }
        composer.typeText("Ask @")

        let other = app.buttons["Sign-in helper"]
        let offered = other.waitForExistence(timeout: 10)
        shot("bot-chat-mention-list")
        if ProcessInfo.processInfo.environment["NUPHOS_EVIDENCE_BASELINE"] == "1" { return }
        XCTAssertTrue(offered, "`@` in a Bot's chat does not offer the other Bot")

        other.tap()
        let draft = composer.value as? String ?? ""
        XCTAssertTrue(draft.hasPrefix("Ask https://") && draft.contains("/agent/bot-box"),
                      "The picked Bot's link is not in the draft: \(draft)")
        shot("bot-chat-mention-picked")
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
