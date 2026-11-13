import XCTest

final class ConversationTriggersUITests: XCTestCase {
    func testConversationTitleOpensTriggers() {
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/conversation-triggers-responses.json")
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-AppleInterfaceStyle", "Light"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()
        let menu = app.buttons["Switch page"].firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 15))
        menu.tap()
        app.buttons["Tasks"].firstMatch.tap()
        let conversation = app.staticTexts["Preview push-a"].firstMatch
        XCTAssertTrue(conversation.waitForExistence(timeout: 15))
        conversation.tap()
        let title = app.buttons["conversation-trigger-entry"].firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 15))
        XCTAssertTrue(title.isHittable)
        title.tap()
        XCTAssertTrue(app.staticTexts["Morning PR digest"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.switches["Enable Production alerts"].exists)
        XCTAssertTrue(app.switches["Enable Weekly dependency review"].exists)
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "triggers-2096-ios"
        capture.lifetime = .keepAlways
        add(capture)
    }
}
