import XCTest

/// A Bot's chat has a floating header: Back, the Bot's name on a capsule, and More.
/// Task and Desktop moved from the bar into More; this keeps every entry reachable.
/// Offline fixture with made-up chats.
final class BotHeaderUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/bot-header-responses.json")
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()
    }

    private func open(_ chat: String) {
        let row = app.staticTexts[chat].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "The Bots page does not list \(chat)")
        row.tap()
        XCTAssertTrue(app.collectionViews["chat.transcript"].cells.firstMatch.waitForExistence(timeout: 15), "\(chat) did not load")
    }

    /// Opens More and returns the item, which must be there and tappable.
    private func moreItem(_ id: String) -> XCUIElement {
        let more = app.buttons["chat.more"]
        XCTAssertTrue(more.waitForExistence(timeout: 10), "The Bot's chat has no More button")
        more.tap()
        let item = app.buttons[id]
        XCTAssertTrue(item.waitForExistence(timeout: 10), "More has no \(id)")
        XCTAssertTrue(item.isHittable, "\(id) is in More but cannot be tapped")
        return item
    }

    func testTheCapsuleOpensBotDetails() {
        open("Trip planner")
        let capsule = app.buttons["bot-details-entry"]
        XCTAssertTrue(capsule.waitForExistence(timeout: 10), "The header has no Bot capsule")
        XCTAssertTrue(capsule.isHittable)
        // The bar draws More as a glass circle the size of Back; its own frame is the inner hit area.
        let back = app.navigationBars.buttons["BackButton"]
        XCTAssertEqual(back.frame.height, 44, accuracy: 1, "Back is not a 44pt circle")
        XCTAssertEqual(app.buttons["chat.more"].frame.midY, back.frame.midY, accuracy: 1, "More and Back are not on one line")
        shot("bot-header-1on1")
        capsule.tap()
        XCTAssertTrue(app.buttons["bot-task-entry"].waitForExistence(timeout: 10), "The capsule did not open Bot details")
    }

    func testMoreReachesTheBotsTask() {
        open("Trip planner")
        XCTAssertFalse(app.buttons["Task"].exists, "Task is still on the bar")
        let task = moreItem("Task")
        shot("bot-header-more")
        task.tap()
        XCTAssertTrue(app.buttons["agent-summary-button"].waitForExistence(timeout: 10), "More > Task did not open the Bot's Task")
    }

    func testMoreReachesTheBotsDesktop() {
        open("Trip planner")
        XCTAssertFalse(app.buttons["Desktop"].exists, "Desktop is still on the bar")
        moreItem("Desktop").tap()
        XCTAssertTrue(app.buttons["Close desktop"].waitForExistence(timeout: 10), "More > Desktop did not open the desktop")
    }

    /// A Bot's own replies carry no avatar or name, 16pt apart.
    func testABotsRepliesAreUnnamedAndSpaced() throws {
        open("Trip planner")
        let transcript = app.collectionViews["chat.transcript"]
        XCTAssertFalse(transcript.staticTexts["Bot"].exists, "A Bot's reply in its own chat is still named")
        let first = transcript.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Have a good trip.'")).firstMatch
        let previous = transcript.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Perfect, thank you!'")).firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 10), "The last reply is not on screen")
        let bubbles = transcript.descendants(matching: .any).matching(identifier: "channel.bubble")
        let last = try XCTUnwrap((0..<bubbles.count).map { bubbles.element(boundBy: $0) }.first { $0.frame.contains(first.frame) })
        let above = try XCTUnwrap((0..<bubbles.count).map { bubbles.element(boundBy: $0) }.first { $0.frame.contains(previous.frame) })
        XCTAssertEqual(last.frame.minY - above.frame.maxY, 16, accuracy: 1, "Messages are not 16pt apart")
    }

    func testAGroupChatKeepsItsSenders() {
        open("weekend-hike")
        XCTAssertTrue(app.collectionViews["chat.transcript"].staticTexts["Mei Chen"].firstMatch.waitForExistence(timeout: 10),
                      "A group chat lost its sender line")
        XCTAssertTrue(app.collectionViews["chat.transcript"].staticTexts["Trip planner"].firstMatch.exists,
                      "A group chat no longer names the Bot")
        XCTAssertFalse(app.buttons["chat.more"].exists, "A group chat has a More with nothing in it")
        XCTAssertTrue(app.buttons["bot-details-entry"].exists, "A group chat lost its header capsule")
        shot("bot-header-group")
    }

    /// Rows go on under the header while scrolling back.
    func testRowsScrollUnderTheHeader() {
        open("Trip planner")
        app.collectionViews["chat.transcript"].swipeDown(velocity: .slow)
        shot("bot-header-scrolling")
        XCTAssertTrue(app.buttons["bot-details-entry"].isHittable, "The capsule is gone while scrolling")
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
