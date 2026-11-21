import XCTest

/// A swipe in from the right edge of a chat opens its dock, mirrored from the Mac: the tab strip
/// and the Mac's New Tab page. Pages open on the phone itself. Uses the offline dock fixture, so
/// it never contacts the backend (the web pages are public placeholders).
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
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"].firstMatch
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        XCTAssertTrue(app.collectionViews["chat.transcript"].cells.firstMatch.waitForExistence(timeout: 10), "The chat did not load")
        return app
    }

    /// Opens the dock and returns once it has finished loading.
    ///
    /// Each step waits for what it is about to touch: the toolbar follows the transcript by a
    /// moment, and the dock draws its tab strip and search field together once the fixture is
    /// in. Waiting for the search field is what makes a tab tappable with its page ready, so a
    /// caller does not have to guess how long the launch took.
    private func openWorkTools(_ app: XCUIApplication) {
        let options = app.buttons["Task options"]
        XCTAssertTrue(options.waitForExistence(timeout: 10), "The chat has no Task options")
        options.tap()
        let workTools = app.buttons["Work tools"]
        XCTAssertTrue(workTools.waitForExistence(timeout: 10), "Task options does not offer Work tools")
        workTools.tap()
        XCTAssertTrue(app.textFields["dock-search"].waitForExistence(timeout: 10), "The dock did not load")
    }

    /// Scrolls the tab strip, or the New Tab list, until `element` can be tapped.
    private func reveal(_ element: XCUIElement, in app: XCUIApplication, sideways: Bool) {
        let window = app.windows.firstMatch
        let onScreen = { element.exists && window.frame.insetBy(dx: 8, dy: 60).contains(CGPoint(x: element.frame.midX, y: element.frame.midY)) }
        // Sideways, drag along the element's own row: the tab strip is not at a fixed height.
        let row = sideways && element.exists ? element.frame.midY / window.frame.height : 0.2
        for _ in 0..<8 where !onScreen() {
            let from = window.coordinate(withNormalizedOffset: CGVector(dx: sideways ? 0.85 : 0.7, dy: sideways ? row : 0.8))
            from.press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: sideways ? 0.35 : 0.7, dy: sideways ? row : 0.4)))
        }
    }

    func testWorkToolsOpensTheMacDockAndItsNewTabPage() {
        let app = launch()
        openWorkTools(app)

        XCTAssertTrue(app.buttons["dock-tab-tab-signup"].waitForExistence(timeout: 5), "Work tools did not open the dock")
        for tab in ["tab-docs", "tab-local", "tab-terminal"] { XCTAssertTrue(app.buttons["dock-tab-\(tab)"].exists, tab) }
        XCTAssertTrue(app.textFields["dock-search"].exists)
        XCTAssertTrue(app.buttons["dock-row-recent-/teams/64b5f1c2e4b0a1d2c3e4f5a6/runtimes"].exists)
        XCTAssertTrue(app.staticTexts["Sign in · Example Finance"].exists)
        XCTAssertTrue(app.staticTexts["Workspace"].exists || app.buttons["dock-row-workspace-team.files"].exists)
    }

    func testABrowserTabOpensNativelyOnThePhoneWithTheMacOneMenuAway() {
        let app = launch()
        openWorkTools(app)
        let tab = app.buttons["dock-tab-tab-signup"]
        XCTAssertTrue(tab.waitForExistence(timeout: 5))
        tab.tap()

        let address = app.textFields["browser-address"]
        XCTAssertTrue(address.waitForExistence(timeout: 5), "The page did not open on the phone")
        XCTAssertEqual(address.value as? String, "https://example.com/signup")
        XCTAssertTrue(app.buttons["Share"].waitForExistence(timeout: 5), "The browser share button needs an accessibility label")
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "browser-share-button"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        XCTAssertTrue(app.otherElements["browser-signed-out"].exists || app.staticTexts["Uses this iPhone's sign-ins, not your Mac's."].exists)
        // No takeover: the live view is only in the menu.
        XCTAssertFalse(app.buttons["Hand back"].exists)
        app.buttons["browser-menu"].tap()
        XCTAssertTrue(app.buttons["Live view on Mac"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Show on Mac"].exists)
        // Kept on purpose: the menu is dismissed by tapping the app itself, and a tap that
        // lands before the menu settles hits one of its items instead.
        sleep(1)
        app.tap()
        app.buttons["browser-done"].tap()
    }

    func testAPageOnTheMacsNetworkLoadsThroughTheMac() {
        let app = launch()
        openWorkTools(app)
        let tab = app.buttons["dock-tab-tab-local"]
        XCTAssertTrue(tab.waitForExistence(timeout: 5))
        reveal(tab, in: app, sideways: true)
        tab.tap()
        XCTAssertTrue(app.staticTexts["Preview app running on your Mac"].waitForExistence(timeout: 10), "The Mac's page did not load")
        XCTAssertEqual(app.textFields["browser-address"].value as? String, "http://localhost:3000/")
        XCTAssertTrue(app.otherElements["browser-live-reload"].exists || app.staticTexts["Loaded from your Mac. Live reload doesn't update here; reload to see changes."].exists)
    }

    func testClosingATabOnThePhoneClosesItInTheStrip() {
        let app = launch()
        openWorkTools(app)
        XCTAssertTrue(app.buttons["dock-tab-tab-terminal"].waitForExistence(timeout: 5))
        reveal(app.buttons["dock-close-tab-tab-terminal"], in: app, sideways: true)
        app.buttons["dock-close-tab-tab-terminal"].tap()
        XCTAssertTrue(app.buttons["dock-tab-tab-terminal"].waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.buttons["dock-tab-tab-docs"].exists)
    }

    func testAPageTheIPhoneDoesNotHaveOpensOnTheMac() {
        let app = launch()
        openWorkTools(app)
        let files = app.buttons["dock-row-workspace-team.files"]
        XCTAssertTrue(app.textFields["dock-search"].waitForExistence(timeout: 5))
        reveal(files, in: app, sideways: false)
        files.tap()
        XCTAssertTrue(app.staticTexts["Files isn't on iPhone yet. It's open on your Mac."].waitForExistence(timeout: 5))
        let close = app.buttons["dock-close"]
        XCTAssertTrue(close.waitForExistence(timeout: 5), "The dock has no close button")
        close.tap()
    }
}
