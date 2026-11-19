import XCTest

@MainActor
final class ComputerNotificationsUITests: XCTestCase {
    func testAccountNavigationAndIndependentSubscriptions() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/computer-notifications-responses.json")
        app.launchArguments = ["-preview-home", "-preview-saved-account", "-preview-no-push", "-AppleInterfaceStyle", "Light"]
        app.launchEnvironment["NUPHOS_PREVIEW_RESPONSES"] = fixture.path
        app.launch()
        let account = app.buttons["Account"]
        XCTAssertTrue(account.waitForExistence(timeout: 15))
        account.tap()
        XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["Computer notifications"].exists)
        capture("01-account-opens-first")
        let notifications = app.buttons["Computer notifications"]
        for _ in 0..<5 {
            if notifications.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(notifications.isHittable)
        notifications.tap()
        XCTAssertTrue(app.navigationBars["Computer notifications"].waitForExistence(timeout: 5))
        let laptop = app.switches["computer-notifications.sample-laptop"]
        let other = app.switches["computer-notifications.sample-box"]
        XCTAssertTrue(laptop.waitForExistence(timeout: 5))
        XCTAssertEqual(laptop.value as? String, "0")
        XCTAssertEqual(other.value as? String, "0")
        capture("02-defaults-off")
        laptop.tap()
        XCTAssertTrue(waitForValue("1", on: laptop))
        XCTAssertEqual(other.value as? String, "0")
        capture("03-only-selected-computer-on")
        laptop.tap()
        XCTAssertTrue(waitForValue("0", on: laptop))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: 5))
        app.buttons["Close account"].tap()
        account.tap()
        XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["Computer notifications"].exists)
        capture("04-reopening-account-does-not-jump")
    }

    private func waitForValue(_ value: String, on element: XCUIElement) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: element)
        return XCTWaiter.wait(for: [expectation], timeout: 5) == .completed
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
