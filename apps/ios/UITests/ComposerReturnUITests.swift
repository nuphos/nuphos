import XCTest

/// Return on a hardware keyboard in the chat composer (#2154). Only an iPad
/// simulator takes hardware key presses. Uses the offline push fixture, so it
/// never contacts the backend.
final class ComposerReturnUITests: XCTestCase {
    func testReturnSendsAndShiftReturnStartsALine() throws {
        let composer = try openComposer()
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

    /// Needs Zhuyin as the simulator's keyboard; skips when keys still type Latin letters.
    func testReturnWhileComposingKeepsTheText() throws {
        let composer = try openComposer()
        for key in ["s", "u", "3"] { composer.typeKey(key, modifierFlags: []) }  // ㄋㄧˇ
        let composed = composer.value as? String ?? ""
        try XCTSkipIf(composed.contains("su3") || composed.isEmpty, "Zhuyin is not the active input method")

        composer.typeKey(.return, modifierFlags: [])
        let committed = composer.value as? String ?? ""
        XCTAssertFalse(committed.isEmpty, "Return while composing lost the text or sent it")

        // Still focused: the next syllable lands in the composer.
        for key in ["c", "l", "3"] { composer.typeKey(key, modifierFlags: []) }  // ㄏㄠˇ
        composer.typeKey(.return, modifierFlags: [])
        XCTAssertGreaterThan((composer.value as? String ?? "").count, committed.count, "The composer lost focus")
    }

    private func openComposer() throws -> XCUIElement {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "Hardware key presses need an iPad")
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/push-responses.json")
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()

        app.staticTexts["Preview push-a"].firstMatch.tap()
        let composer = app.descendants(matching: .any).matching(NSPredicate(
            format: "label BEGINSWITH %@ AND (elementType == %d OR elementType == %d)", "Ask Nuphos",
            XCUIElement.ElementType.textView.rawValue, XCUIElement.ElementType.textField.rawValue
        )).firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10), "No composer")
        composer.tap()
        return composer
    }
}
