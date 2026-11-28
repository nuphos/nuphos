import XCTest

final class ConversationTriggersUITests: XCTestCase {
    func testConversationTitleOpensTriggers() {
        let app = openTriggers()
        XCTAssertTrue(app.switches["Enable Production alerts"].exists)
        XCTAssertTrue(app.switches["Enable Weekly dependency review"].exists)
        shoot("triggers-2096-ios")
    }

    func testARowOpensItsDetailsAndEditStartsAMessage() {
        let app = openTriggers()
        // The switch is its own control: flipping it leaves the list where it is.
        app.switches["Enable Weekly dependency review"].firstMatch.tap()
        XCTAssertFalse(app.staticTexts["trigger-instruction"].waitForExistence(timeout: 2), "The switch opened the row")
        XCTAssertTrue(app.buttons["trigger-row-digest"].isHittable)

        app.buttons["trigger-row-digest"].firstMatch.tap()
        let instruction = app.staticTexts["trigger-instruction"].firstMatch
        XCTAssertTrue(instruction.waitForExistence(timeout: 5))
        XCTAssertEqual(instruction.label, "Summarize the pull requests merged since yesterday and post the list here.")
        shoot("trigger-details-4095-ios")

        app.buttons["trigger-edit"].firstMatch.tap()
        let composer = app.textViews.firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["trigger-edit"].exists, "Edit left the sheet open")
        XCTAssertEqual(composer.value as? String, "Edit your trigger “Morning PR digest”: ")
        shoot("trigger-edit-4095-ios")
    }

    private func openTriggers() -> XCUIApplication {
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/conversation-triggers-responses.json")
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-AppleInterfaceStyle", "Light"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()
        let tasks = app.tabBars.buttons["Tasks"].firstMatch
        XCTAssertTrue(tasks.waitForExistence(timeout: 15))
        tasks.tap()
        let conversation = app.staticTexts["Preview push-a"].firstMatch
        XCTAssertTrue(conversation.waitForExistence(timeout: 15))
        conversation.tap()
        let title = app.buttons["conversation-trigger-entry"].firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 15))
        XCTAssertTrue(title.isHittable)
        title.tap()
        XCTAssertTrue(app.buttons["trigger-row-digest"].waitForExistence(timeout: 10))
        return app
    }

    private func shoot(_ name: String) {
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = name
        capture.lifetime = .keepAlways
        add(capture)
    }
}
