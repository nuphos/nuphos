import XCTest

/// A Bot's 1:1 chat shows a desktop button only while its runtime has a desktop,
/// and the button opens the same viewer as the Bot's Task page. Offline fixture.
final class BotDesktopUITests: XCTestCase {
    func testDesktopButtonOnlyForBotWithDesktop() {
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/bot-desktop-responses.json")
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()

        let button = app.buttons["Desktop"]
        let more = app.buttons["chat.more"]
        let transcript = app.collectionViews["chat.transcript"].cells.firstMatch

        app.staticTexts["Release notes"].firstMatch.tap()
        XCTAssertTrue(transcript.waitForExistence(timeout: 10), "The Bot's chat did not load")
        // This Bot has neither a Task nor a desktop, so its header has nothing to put in More.
        XCTAssertFalse(more.exists, "A Bot without a desktop or Task shows More")
        XCTAssertFalse(button.exists, "A Bot without a desktop shows the desktop button")

        app.navigationBars.buttons["BackButton"].tap()
        app.staticTexts["Sign-in helper"].firstMatch.tap()
        XCTAssertTrue(more.waitForExistence(timeout: 10), "The Bot's chat has no More button")
        more.tap()
        XCTAssertTrue(button.waitForExistence(timeout: 10), "A Bot with a desktop has no desktop button")
        button.tap()
        XCTAssertTrue(app.buttons["Close desktop"].waitForExistence(timeout: 10), "The desktop viewer did not open")
    }

    /// A desktop that can't connect says so below the keys, not over them (#3610).
    func testTheErrorCardLeavesTheKeysUncovered() {
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/bot-desktop-responses.json")
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()

        app.staticTexts["Sign-in helper"].firstMatch.tap()
        let more = app.buttons["chat.more"]
        XCTAssertTrue(more.waitForExistence(timeout: 10), "The Bot's chat has no More button")
        more.tap()
        let button = app.buttons["Desktop"]
        XCTAssertTrue(button.waitForExistence(timeout: 10), "A Bot with a desktop has no desktop button")
        button.tap()
        let retry = app.buttons["Try again"]
        XCTAssertTrue(retry.waitForExistence(timeout: 15), "The desktop did not fail as the fixture has it")
        let card = app.otherElements["desktop.error"]
        XCTAssertTrue(card.exists, "No error card")
        let keys = ["esc", "tab", "←", "→"].map { app.buttons[$0].firstMatch }
        for key in keys {
            XCTAssertTrue(key.exists, "No \(key) key")
            XCTAssertFalse(key.frame.intersects(card.frame), "The error card covers the \(key.label) key")
        }
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "desktop-error-card"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
