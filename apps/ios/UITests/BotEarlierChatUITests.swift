import XCTest

/// An older Bot's first chat starts empty: its placeholder leads back to the Bot's own Task,
/// where the earlier conversation is, as on Desktop (#5061). A new Bot's chat has nothing earlier.
/// Offline fixture with made-up chats.
final class BotEarlierChatUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/bot-earlier-responses.json")
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()
    }

    private func open(_ chat: String) {
        let row = app.staticTexts[chat].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "The Chats page does not list \(chat)")
        row.tap()
        XCTAssertTrue(app.otherElements["chat.empty"].waitForExistence(timeout: 15), "\(chat) did not open empty")
    }

    func testAnOlderBotsEmptyChatLeadsBackToItsTask() {
        open("Trip planner")
        let earlier = app.buttons["chat.earlier"]
        XCTAssertTrue(earlier.waitForExistence(timeout: 10), "The empty chat of a Bot used before it has no way back to it")
        XCTAssertEqual(earlier.label, "See earlier messages with Trip planner")
        XCTAssertTrue(earlier.isHittable)
        shot("bot-chat-earlier")
        earlier.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Here is a slow-paced plan'")).firstMatch
            .waitForExistence(timeout: 15), "The link did not open the Bot's Task with its earlier conversation")
        shot("bot-chat-earlier-task")
    }

    func testANewBotsChatHasNothingEarlier() {
        open("Meeting notes")
        XCTAssertTrue(app.staticTexts["You can start by telling Meeting notes what you would like to do."].waitForExistence(timeout: 10))
        // The Bot's Task is reachable from More, so only the times keep the link away.
        XCTAssertTrue(app.buttons["chat.more"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["chat.earlier"].waitForExistence(timeout: 3), "A Bot that only moved once its chat existed leads back")
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
