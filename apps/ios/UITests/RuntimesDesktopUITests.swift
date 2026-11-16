import XCTest

/// The Runtimes page offers Desktop on each computer the device list names a desktop for,
/// whether or not it has a runtime, and on no other. Offline fixture.
final class RuntimesDesktopUITests: XCTestCase {
    func testDesktopButtonFollowsTheDeviceList() {
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/runtimes-desktop-responses.json")
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "runtimes"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()

        XCTAssertTrue(app.staticTexts["Robin's Mac"].waitForExistence(timeout: 10), "The Runtimes page did not load")
        XCTAssertTrue(app.buttons["desktop-device:macbook"].exists, "Your computer with a runtime has no Desktop button")
        XCTAssertFalse(app.buttons["desktop-device:teammate-mac"].exists, "A teammate's computer shows a Desktop button")

        let agentless = app.buttons["desktop-device:mac-mini"]
        XCTAssertTrue(agentless.exists, "Your computer with no runtime has no Desktop button")
        agentless.tap()
        XCTAssertTrue(app.buttons["Close desktop"].waitForExistence(timeout: 10), "The desktop viewer did not open")
    }
}
