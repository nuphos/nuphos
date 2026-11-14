import XCTest

/// Scratch only: asks the shell (via NUPHOS_SHOTS/<name>.req) to take each screenshot.
final class ComputerAlertsShotsUITests: XCTestCase {
    private func shot(_ name: String) {
        guard let dir = ProcessInfo.processInfo.environment["NUPHOS_SHOTS"] else { return }
        let req = URL(filePath: dir).appending(path: "\(name).req")
        try? Data().write(to: req)
        for _ in 0..<60 where FileManager.default.fileExists(atPath: req.path) { Thread.sleep(forTimeInterval: 0.5) }
    }

    func testShots() {
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/push-responses.json")
        let app = XCUIApplication()
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"]
        if allow.waitForExistence(timeout: 10) { allow.tap() }
        XCTAssertTrue(app.buttons["Account"].waitForExistence(timeout: 15))
        app.buttons["Account"].tap()
        let toggle = app.switches["Computers going offline"]
        XCTAssertTrue(app.navigationBars.firstMatch.waitForExistence(timeout: 5))
        for _ in 0..<8 where !toggle.isHittable { app.swipeUp() }
        XCTAssertTrue(toggle.isHittable)
        XCTAssertEqual(toggle.value as? String, "1")
        app.swipeUp()
        Thread.sleep(forTimeInterval: 1)
        shot("1-setting")
        XCUIDevice.shared.press(.home)
        let later = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"]
        if later.waitForExistence(timeout: 15) { later.tap() }
        Thread.sleep(forTimeInterval: 2)
        shot("2-offline")
        Thread.sleep(forTimeInterval: 6)
        shot("3-online")
    }
}
