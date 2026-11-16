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
        XCTAssertTrue(app.buttons["Connectors"].exists)
        shot("native-tabs-account-workspace")
        app.buttons["Computers"].tap()
        XCTAssertTrue(app.navigationBars["Computers"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["BackButton"].tap()
        app.buttons["Connectors"].tap()
        XCTAssertTrue(app.navigationBars["Connectors"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["BackButton"].tap()
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

    private func shot(_ name: String) {
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = name
        capture.lifetime = .keepAlways
        add(capture)
    }
}
