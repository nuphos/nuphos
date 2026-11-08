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

        let button = app.buttons["chat.desktop"]
        let transcript = app.collectionViews["chat.transcript"].cells.firstMatch

        app.staticTexts["Release notes"].firstMatch.tap()
        XCTAssertTrue(transcript.waitForExistence(timeout: 10), "The Bot's chat did not load")
        XCTAssertFalse(button.exists, "A Bot without a desktop shows the desktop button")

        app.navigationBars.buttons["BackButton"].tap()
        app.staticTexts["Sign-in helper"].firstMatch.tap()
        XCTAssertTrue(button.waitForExistence(timeout: 10), "A Bot with a desktop has no desktop button")
        button.tap()
        XCTAssertTrue(app.buttons["Close desktop"].waitForExistence(timeout: 10), "The desktop viewer did not open")
    }
}
