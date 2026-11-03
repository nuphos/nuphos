import XCTest

/// Opening a second chat from the Chats list, after going back from the first,
/// must load it. Uses the offline chats fixture, so it never contacts the backend.
final class ChannelReopenUITests: XCTestCase {
    func testSecondChannelFromListLoads() {
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()

        let transcript = app.collectionViews["chat.transcript"].cells.firstMatch
        let failed = app.staticTexts["Couldn't load this chat"]
        app.staticTexts["release-planning"].firstMatch.tap()
        XCTAssertTrue(transcript.waitForExistence(timeout: 10), "Chat A did not load")

        app.navigationBars.buttons["BackButton"].tap()
        app.staticTexts["design-review"].firstMatch.tap()
        // The fixture's second chat has no posts yet.
        let empty = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Everyone here sees'")).firstMatch
        XCTAssertTrue(empty.waitForExistence(timeout: 10), "Chat B, opened after going back, never loaded")
        XCTAssertFalse(failed.exists)

        app.navigationBars.buttons["BackButton"].tap()
        app.staticTexts["release-planning"].firstMatch.tap()
        XCTAssertTrue(transcript.waitForExistence(timeout: 10), "Chat A, opened again, never loaded")
        XCTAssertFalse(failed.exists)
    }
}
