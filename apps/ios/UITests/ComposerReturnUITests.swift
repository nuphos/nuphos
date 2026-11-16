import XCTest

/// On a hardware keyboard, Return sends the draft and Shift-Return starts a
/// new line (#2154). Only an iPad simulator takes hardware key presses. Uses
/// the offline push fixture, so it never contacts the backend.
final class ComposerReturnUITests: XCTestCase {
    func testReturnSendsAndShiftReturnStartsALine() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "Hardware key presses need an iPad")
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/push-responses.json")
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()

        app.staticTexts["Preview push-a"].firstMatch.tap()
        let composer = app.textViews.matching(NSPredicate(format: "label BEGINSWITH %@", "Ask Nuphos")).firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10), "No composer")
        composer.tap()

        composer.typeText("one")
        composer.typeKey(.return, modifierFlags: .shift)
        composer.typeText("two")
        XCTAssertEqual(composer.value as? String, "one\ntwo", "Shift-Return did not start a new line")

        composer.typeKey(.return, modifierFlags: [])
        expectation(for: NSPredicate(format: "NOT (value CONTAINS %@)", "two"), evaluatedWith: composer)
        waitForExpectations(timeout: 5)

        // Still focused, so the next message can be typed straight away.
        composer.typeText("three")
        XCTAssertEqual(composer.value as? String, "three")
    }
}
