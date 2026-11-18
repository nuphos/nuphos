import XCTest

/// Opening a second chat from the Chats list, after going back from the first,
/// must load it. Uses the offline chats fixture, so it never contacts the backend.
final class ChannelReopenUITests: XCTestCase {
    private let fixture = URL(filePath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "tests/fixtures/channel-responses.json")

    func testSecondChannelFromListLoads() {
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

    /// Leaving the app while a chat's first read is on its way cancels that read.
    /// The chat loads on return; a cancelled read is not a failure to show.
    func testAChatLeftWhileLoadingLoadsOnReturn() throws {
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        var detail = try XCTUnwrap(responses["GET /agent/conversations/chat-release"] as? [String: Any])
        detail["delayMs"] = 3000
        responses["GET /agent/conversations/chat-release"] = detail
        let live = fixture.deletingLastPathComponent().appending(path: "channel-cancel-live-\(UUID().uuidString).json")
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
        defer { try? FileManager.default.removeItem(at: live) }

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()

        app.staticTexts["release-planning"].firstMatch.tap()
        sleep(1)
        XCUIDevice.shared.press(.home)
        sleep(1)
        app.activate()

        let failed = app.staticTexts["Couldn't load this chat"]
        let transcript = app.collectionViews["chat.transcript"].cells.firstMatch
        XCTAssertFalse(failed.waitForExistence(timeout: 3), "The cancelled read showed as a failure")
        XCTAssertTrue(transcript.waitForExistence(timeout: 15), "The chat did not load after returning")
        XCTAssertFalse(failed.exists)
    }
}
