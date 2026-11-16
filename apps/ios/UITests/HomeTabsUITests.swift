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
        XCTAssertTrue(app.buttons["New Bot"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars.buttons["New Bot"].exists)
        app.navigationBars.buttons["New Bot"].tap()
        XCTAssertTrue(app.navigationBars["New Bot"].waitForExistence(timeout: 5))
        app.buttons["Cancel"].tap()
        shot("native-tabs-bots")
        tabs.buttons["Inbox"].tap()
        XCTAssertTrue(tabs.buttons["Inbox"].isSelected)
        tabs.buttons["Tasks"].tap()
        XCTAssertFalse(app.buttons["Workspace"].exists)
        app.buttons["Account"].tap()
        XCTAssertTrue(app.buttons["Computers"].waitForExistence(timeout: 5))
        shot("native-tabs-account-workspace")
        app.buttons["Computers"].tap()
        XCTAssertTrue(app.navigationBars["Computers"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["BackButton"].tap()
        app.buttons["Done"].tap()
        app.navigationBars.buttons["Connectors"].tap()
        XCTAssertTrue(app.navigationBars["Connectors"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
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

    func testTaskDraftSurvivesTabSwitch() throws {
        let app = XCUIApplication()
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 10))
        try XCTSkipUnless(app.windows.firstMatch.horizontalSizeClass == .compact,
                          "The compact home composer is covered here; the iPad detail composer is separate.")
        let composer = app.textFields.firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText("Keep this unsent task")
        composer.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: -0.15))
            .press(forDuration: 0.1, thenDragTo: composer.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 2)))
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        app.tabBars.buttons["Bots"].tap()
        XCTAssertTrue(app.buttons["New Bot"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Tasks"].tap()
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
        XCTAssertTrue(app.buttons["New Bot"].waitForExistence(timeout: 5))
        XCTAssertTrue(tabs.buttons["Bots"].isSelected)
        shot("review-bots")
        tabs.buttons["Inbox"].tap()
        XCTAssertTrue(tabs.buttons["Inbox"].isSelected)
        shot("review-inbox")
        app.buttons["Account"].tap()
        XCTAssertTrue(app.buttons["Computers"].waitForExistence(timeout: 5))
        app.buttons["Computers"].tap()
        XCTAssertTrue(app.navigationBars["Computers"].waitForExistence(timeout: 5))
        shot("review-computers")
        app.navigationBars.buttons["BackButton"].tap()
        app.buttons["Done"].tap()
        app.navigationBars.buttons["Connectors"].tap()
        XCTAssertTrue(app.navigationBars["Connectors"].waitForExistence(timeout: 5))
        shot("review-connectors")
        app.buttons["Done"].tap()
        tabs.buttons["Tasks"].tap()
        let composer = app.textFields.firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        let wide = app.windows.firstMatch.horizontalSizeClass == .regular
        if wide {
            XCTAssertGreaterThan(composer.frame.midX, app.frame.width * 0.4, "The wide composer belongs in the detail column")
            composer.tap()
            composer.typeText("Review iPad unsent task")
            XCTAssertTrue(String(describing: composer.value).contains("Review iPad unsent task"))
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
            shot("review-ipad-detail-keyboard")
            let hide = app.keyboards.buttons["Hide keyboard"].firstMatch
            if hide.exists { hide.tap() }
            else {
                composer.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: -0.15))
                    .press(forDuration: 0.1, thenDragTo: composer.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 2)))
            }
            XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        }
        tabs.buttons["Bots"].tap()
        app.staticTexts["design-review"].firstMatch.tap()
        XCTAssertTrue(app.otherElements["chat.empty"].waitForExistence(timeout: 5))
        shot("review-bot-conversation")
        if !wide { app.navigationBars.buttons["BackButton"].tap() }
        tabs.buttons["Tasks"].tap()
        XCTAssertTrue(tabs.buttons["Tasks"].isSelected)
        XCTAssertTrue(app.otherElements["chat.empty"].waitForNonExistence(timeout: 5), "The Bot conversation leaked into Tasks")
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        if wide {
            XCTAssertTrue(String(describing: composer.value).contains("Review iPad unsent task"))
            shot("review-ipad-detail-restored")
        }
    }

    private func shot(_ name: String) {
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = name
        capture.lifetime = .keepAlways
        add(capture)
    }
}
