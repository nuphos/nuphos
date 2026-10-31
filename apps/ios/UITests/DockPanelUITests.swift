import XCTest

/// A swipe in from the right edge of a chat opens its dock: the desktop and the browser tabs
/// its agent opened on the owner's computer. Uses the offline dock fixture, so it never
/// contacts the backend.
final class DockPanelUITests: XCTestCase {
    private func launch() -> XCUIApplication {
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/dock-responses.json")
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-open-links", "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/dock-a"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()
        // A fresh simulator asks once about notifications.
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        XCTAssertTrue(app.collectionViews["chat.transcript"].cells.firstMatch.waitForExistence(timeout: 10), "The chat did not load")
        return app
    }

    private func swipeInFromRightEdge(_ app: XCUIApplication) {
        let window = app.windows.firstMatch
        let edge = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 0.45))
        edge.press(forDuration: 0.01, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.45, dy: 0.45)))
    }

    func testRightEdgeSwipeOpensTheDockWithItsBrowserTabs() {
        let app = launch()
        sleep(1)
        swipeInFromRightEdge(app)

        let tab = app.buttons["dock-tab-tab-signup"]
        XCTAssertTrue(tab.waitForExistence(timeout: 5), "The swipe did not open the dock")
        XCTAssertTrue(app.buttons["dock-tab-tab-docs"].exists)
        XCTAssertTrue(app.buttons["dock-desktop"].exists)
        sleep(2)

        // Tapping a tab shows it on the computer and opens the desktop on it.
        tab.tap()
        XCTAssertTrue(app.buttons["dock-tab-tab-signup"].waitForNonExistence(timeout: 5), "The desktop did not open")
        sleep(3)
    }

    func testDockButtonOpensAndClosesIt() {
        let app = launch()
        app.buttons["dock-button"].tap()
        XCTAssertTrue(app.buttons["dock-tab-tab-docs"].waitForExistence(timeout: 5))
        sleep(1)
        app.buttons["dock-close"].tap()
        XCTAssertTrue(app.buttons["dock-tab-tab-docs"].waitForNonExistence(timeout: 5))
    }
}
