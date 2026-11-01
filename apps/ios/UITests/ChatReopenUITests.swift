import XCTest

/// Opening a second chat from the list must load it. Uses the offline push
/// fixture, so it never contacts the backend.
final class ChatReopenUITests: XCTestCase {
    func testSecondChatFromListLoads() {
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/push-responses.json")
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()

        let transcript = app.collectionViews["chat.transcript"].cells.firstMatch
        app.staticTexts["Preview push-a"].firstMatch.tap()
        XCTAssertTrue(transcript.waitForExistence(timeout: 10), "Chat A did not load")

        app.navigationBars.buttons["BackButton"].tap()
        app.staticTexts["Preview push-b"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Preview push-b"].waitForExistence(timeout: 5))
        XCTAssertTrue(transcript.waitForExistence(timeout: 10), "Chat B, opened after going back, never loaded")
    }
}
