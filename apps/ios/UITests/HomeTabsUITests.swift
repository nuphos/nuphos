import XCTest

final class HomeTabsUITests: XCTestCase {
    func testNativeTabsExposeWorkspacePagesAndOpenChats() throws {
        let app = XCUIApplication()
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()

        let tabs = app.tabBars.firstMatch
        XCTAssertTrue(tabs.waitForExistence(timeout: 10), "The home pages need a system tab bar")
        XCTAssertTrue(tabs.buttons["Bots"].exists)
        XCTAssertTrue(tabs.buttons["Tasks"].isSelected)
        XCTAssertTrue(tabs.buttons["Inbox"].exists)
        shot("native-tabs-tasks")
        tabs.buttons["Bots"].tap()
        XCTAssertTrue(app.buttons["Create"].waitForExistence(timeout: 5))
        app.buttons["Create"].tap()
        app.buttons["New Bot"].tap()
        XCTAssertTrue(app.navigationBars["New Bot"].waitForExistence(timeout: 5))
        app.buttons["Cancel"].tap()
        shot("native-tabs-bots")
        tabs.buttons["Inbox"].tap()
        XCTAssertTrue(tabs.buttons["Inbox"].isSelected)
        tabs.buttons["Tasks"].tap()
        XCTAssertTrue(app.buttons["Account"].exists)
        app.buttons["Account"].tap()
        XCTAssertTrue(app.buttons["Connectors"].waitForExistence(timeout: 5))
        shot("native-tabs-account-workspace")
        app.buttons["Connectors"].tap()
        XCTAssertTrue(app.navigationBars["Connectors"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["BackButton"].tap()
        app.buttons["Close account"].tap()
        app.buttons["Computers & runtimes"].tap()
        XCTAssertTrue(app.navigationBars["Computers & runtimes"].waitForExistence(timeout: 5))
        app.buttons["Close workspace"].tap()
        XCTAssertTrue(tabs.buttons["Tasks"].isSelected)
        tabs.buttons["Bots"].tap()
        app.staticTexts["design-review"].firstMatch.tap()
        XCTAssertTrue(app.otherElements["chat.empty"].waitForExistence(timeout: 5))
        shot("native-tabs-conversation")
        if app.windows.firstMatch.horizontalSizeClass == .compact {
            app.navigationBars.buttons["BackButton"].tap()
        }
        tabs.buttons["Tasks"].tap()
        XCTAssertTrue(tabs.buttons["Tasks"].isSelected)
    }

    /// Opening a Bot or a Task leaves the keyboard down until the composer is tapped (#3591).
    func testOpeningBotOrTaskLeavesKeyboardHidden() throws {
        let app = XCUIApplication()
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        var responses = try JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as! [String: Any]
        let listing = responses["GET /agent/conversations"] as! [String: Any]
        let body = listing["body"] as! [String: Any]
        var taskBody = (body["conversations"] as! [[String: Any]])[0]
        taskBody["messages"] = []
        taskBody["messagesFirstIndex"] = 0
        responses["GET /agent/conversations/agent-ops"] = ["status": 200, "body": taskBody]
        let responseFile = FileManager.default.temporaryDirectory.appending(path: "focus-\(UUID().uuidString).json")
        try JSONSerialization.data(withJSONObject: responses).write(to: responseFile)
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": responseFile.path]
        app.launch()
        XCTAssertTrue(app.staticTexts["design-review"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        app.staticTexts["design-review"].firstMatch.tap()
        XCTAssertTrue(app.otherElements["chat.empty"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.keyboards.firstMatch.waitForExistence(timeout: 2), "Opening a Bot raised the keyboard")
        shot("existing-bot-keyboard-hidden")
        app.textViews.firstMatch.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "Tapping the composer did not raise the keyboard")
        // A fresh entry keeps the first chat's keyboard and iPad detail selection
        // from carrying over to the Task.
        app.terminate()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent"]
        app.launch()
        let task = app.staticTexts["Release ops"].firstMatch
        XCTAssertTrue(task.waitForExistence(timeout: 5))
        task.tap()
        XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.keyboards.firstMatch.waitForExistence(timeout: 2), "Opening a Task raised the keyboard")
        XCTAssertFalse(app.staticTexts["Couldn't load this task"].exists)
        shot("existing-task-keyboard-hidden")
    }

    func testTaskDraftSurvivesTabSwitch() throws {
        let app = XCUIApplication()
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 10))
        app.buttons["Create"].tap()
        app.buttons["New Task"].tap()
        let composer = app.textViews.firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText("Keep this unsent task")
        app.navigationBars.buttons["Cancel"].tap()
        app.tabBars.buttons["Bots"].tap()
        XCTAssertTrue(app.buttons["Create"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Tasks"].tap()
        app.buttons["Create"].tap()
        app.buttons["New Task"].tap()
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        XCTAssertTrue(String(describing: composer.value).contains("Keep this unsent task"))
    }

    /// Capture every relocated destination and exercise the wide detail
    /// composer, including returning from a Bot to an unsent Task.
    func testDestinationsAndWideComposerEvidence() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent", "-AppleInterfaceStyle", "Light"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()
        let tabs = app.tabBars.firstMatch
        XCTAssertTrue(app.staticTexts["Release ops"].firstMatch.waitForExistence(timeout: 15))
        shot("review-tasks")
        tabs.buttons["Bots"].tap()
        XCTAssertTrue(app.buttons["Create"].waitForExistence(timeout: 5))
        XCTAssertTrue(tabs.buttons["Bots"].isSelected)
        shot("review-bots")
        tabs.buttons["Inbox"].tap()
        XCTAssertTrue(tabs.buttons["Inbox"].isSelected)
        shot("review-inbox")
        app.buttons["Account"].tap()
        XCTAssertTrue(app.buttons["Connectors"].waitForExistence(timeout: 5))
        app.buttons["Connectors"].tap()
        XCTAssertTrue(app.navigationBars["Connectors"].waitForExistence(timeout: 5))
        shot("review-computers")
        app.navigationBars.buttons["BackButton"].tap()
        app.buttons["Close account"].tap()
        app.buttons["Computers & runtimes"].tap()
        XCTAssertTrue(app.navigationBars["Computers & runtimes"].waitForExistence(timeout: 5))
        shot("review-connectors")
        app.buttons["Close workspace"].tap()
        tabs.buttons["Tasks"].tap()
        let wide = app.windows.firstMatch.horizontalSizeClass == .regular
        XCTAssertFalse(app.textFields.firstMatch.exists)
        app.buttons["Create"].tap()
        app.buttons["New Task"].tap()
        let composer = app.textViews.firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText("Review unsent task")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        shot("review-new-task-keyboard")
        app.navigationBars.buttons["Cancel"].tap()
        tabs.buttons["Bots"].tap()
        app.staticTexts["design-review"].firstMatch.tap()
        XCTAssertTrue(app.otherElements["chat.empty"].waitForExistence(timeout: 5))
        shot("review-bot-conversation")
        if !wide { app.navigationBars.buttons["BackButton"].tap() }
        tabs.buttons["Tasks"].tap()
        XCTAssertTrue(tabs.buttons["Tasks"].isSelected)
        XCTAssertTrue(app.otherElements["chat.empty"].waitForNonExistence(timeout: 5), "The Bot conversation leaked into Tasks")
        XCTAssertFalse(composer.exists)
        app.buttons["Create"].tap()
        app.buttons["New Task"].tap()
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        XCTAssertTrue(String(describing: composer.value).contains("Review unsent task"))
        shot("review-new-task-restored")
    }

    func testNewTaskSheetPreservesDraftOnCancel() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.textFields.firstMatch.exists, "The task list must not have a persistent composer")
        app.buttons["Create"].tap()
        app.buttons["New Task"].tap()
        XCTAssertTrue(app.navigationBars["New Task"].waitForExistence(timeout: 5))
        let composer = app.textViews.firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "New Task should focus the composer without a tap")
        composer.typeText("Keep my new task draft")
        shot("new-task-sheet-draft")
        app.navigationBars.buttons["Cancel"].tap()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields.firstMatch.exists)
        app.buttons["Create"].tap()
        app.buttons["New Task"].tap()
        XCTAssertTrue(String(describing: composer.value).contains("Keep my new task draft"))
        shot("new-task-sheet-restored")
    }

    func testNewTaskSubmissionDismissesSheetAndOpensConversation() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 10))
        app.buttons["Create"].tap()
        app.buttons["New Task"].tap()
        XCTAssertTrue(app.navigationBars["New Task"].waitForExistence(timeout: 5))
        let composer = app.textViews.firstMatch
        composer.tap()
        composer.typeText("Summarize the release checklist")
        let send = app.buttons["Send"].firstMatch
        XCTAssertTrue(send.isEnabled)
        send.tap()
        XCTAssertTrue(app.navigationBars["New Task"].waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.buttons["conversation-trigger-entry"].waitForExistence(timeout: 10), "Submission must open the conversation after the sheet closes")
        shot("new-task-submitted")
    }

    /// #3433: on iPhone Duo's folded cover screen Account hung past the screen's edge. On every
    /// device the three actions sit in the header at the top of the screen, whole and tappable.
    func testHomeActionsStayInTopHeader() throws {
        let app = XCUIApplication()
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent", "-AppleInterfaceStyle", "Light"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()

        XCTAssertTrue(app.buttons["Account"].waitForExistence(timeout: 10))
        let window = app.windows.firstMatch.frame
        let team = app.buttons["Switch team"].firstMatch.frame
        for name in ["Create", "Computers & runtimes", "Account"] {
            let button = app.buttons[name].firstMatch
            XCTAssertTrue(button.isHittable, "\(name) must be tappable")
            XCTAssertTrue(window.contains(button.frame), "\(name) at \(button.frame) must be inside \(window)")
            XCTAssertLessThan(abs(button.frame.midY - team.midY), 8, "\(name) at \(button.frame) must sit in the header beside the team at \(team)")
        }
        shot("home-actions-in-top-header")
    }

    private func shot(_ name: String) {
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = name
        capture.lifetime = .keepAlways
        add(capture)
    }
}
