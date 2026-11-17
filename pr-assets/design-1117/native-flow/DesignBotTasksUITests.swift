import XCTest

/// Offline interaction prototype only. Not production implementation.
final class DesignBotTasksUITests: XCTestCase {
    var app: XCUIApplication!
    func launch(_ proposal: Bool) {
        continueAfterFailure = false
        app = XCUIApplication()
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appending(path: "tests/fixtures/design-bot-tasks.json")
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats", "-nuphos.agent.foldedThreads", "{}"]
        if proposal { app.launchArguments.append("-design-bot-tasks") }
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()
        XCTAssertTrue(app.staticTexts["Release Bot"].firstMatch.waitForExistence(timeout: 15))
    }
    func shot(_ name: String) {
        sleep(1)
        let dir = ProcessInfo.processInfo.environment["NUPHOS_SHOTS"] ?? "/tmp/nuphos-design-shots"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        for (i, screen) in XCUIScreen.screens.enumerated() {
            let image = screen.screenshot()
            try? image.pngRepresentation.write(to: URL(filePath: dir).appending(path: "\(name)-screen\(i).png"))
            let attachment = XCTAttachment(screenshot: image); attachment.name = "\(name)-screen\(i)";attachment.lifetime = .keepAlways;add(attachment)
        }
    }
    func back() {
        let button = app.buttons["BackButton"].firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 5), app.debugDescription)
        button.tap()
    }
    func testCurrent() {
        launch(false)
        shot("before-01-bots")
        app.staticTexts["Release Bot"].firstMatch.tap()
        XCTAssertTrue(app.buttons["bot-trigger-entry"].waitForExistence(timeout: 10))
        shot("before-02-bot-no-task-entry")
        if app.buttons["BackButton"].firstMatch.exists { back() }
        let fold = app.buttons["Show 2 sub-agents"].firstMatch
        XCTAssertTrue(fold.waitForExistence(timeout: 5));fold.tap()
        shot("before-03-bots-expanded")
        app.staticTexts["Draft release notes"].firstMatch.tap()
        XCTAssertTrue(app.buttons["conversation-trigger-entry"].waitForExistence(timeout: 10))
        shot("before-04-child-task")
        if app.buttons["BackButton"].firstMatch.exists { back() }
        else { app.staticTexts["Release Bot"].firstMatch.tap() }
        shot("before-05-return")
        app.terminate()
    }
    func testProposal() {
        launch(true)
        shot("after-01-bots")
        app.staticTexts["Release Bot"].firstMatch.tap()
        XCTAssertTrue(app.buttons["design.tasks"].waitForExistence(timeout: 10))
        shot("after-02-bot")
        app.buttons["design.tasks"].tap()
        XCTAssertTrue(app.buttons["design.row.bot-plain"].waitForExistence(timeout: 5))
        shot("after-03-task-chooser")
        app.buttons["design.row.bot-plain"].tap()
        XCTAssertTrue(app.buttons["conversation-trigger-entry"].waitForExistence(timeout: 10))
        shot("after-04-own-task")
        back()
        XCTAssertTrue(app.buttons["design.tasks"].waitForExistence(timeout: 5))
        shot("after-05-back-to-bot")
        app.buttons["design.tasks"].tap()
        app.buttons["design.row.task-notes"].tap()
        XCTAssertTrue(app.buttons["conversation-trigger-entry"].waitForExistence(timeout: 10))
        shot("after-06-child-task")
        back()
        XCTAssertTrue(app.buttons["design.tasks"].waitForExistence(timeout: 5))
        shot("after-07-child-back-to-bot")
        app.buttons["design.tasks"].tap()
        app.buttons["design.close"].tap()
        XCTAssertTrue(app.buttons["bot-trigger-entry"].waitForExistence(timeout: 5))
        shot("after-08-cancel-stays-on-bot")
        if app.buttons["BackButton"].firstMatch.exists { back() }
        shot("after-09-back-to-list")
        app.terminate()
    }
}
