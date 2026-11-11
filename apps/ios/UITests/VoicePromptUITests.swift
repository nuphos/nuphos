import XCTest

/// Account's transcription prompt: the default until it is edited, the edited
/// text after a relaunch, and the default again after Reset prompt.
final class VoicePromptUITests: XCTestCase {
    private let standard = "Nuphos, Claude Code, Codex, GitHub, Linear, Slack, Discord."
    private var app: XCUIApplication!

    func testDefaultCustomAndReset() {
        continueAfterFailure = false
        var field = openAccount()
        // A simulator this test ran on before holds the default it reset to.
        XCTAssertEqual(field.value as? String, standard)
        shot("default")

        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: standard.count) + "Fixture vocabulary")
        XCTAssertEqual(field.value as? String, "Fixture vocabulary")
        app.terminate()

        field = openAccount()
        XCTAssertEqual(field.value as? String, "Fixture vocabulary", "The edited prompt did not survive a relaunch")
        shot("custom")

        app.buttons["Reset prompt"].tap()
        XCTAssertEqual(field.value as? String, standard)
        XCTAssertFalse(app.buttons["Reset prompt"].exists)
    }

    private func openAccount() -> XCUIElement {
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launch()
        let account = app.buttons["Account"].firstMatch
        XCTAssertTrue(account.waitForExistence(timeout: 10), "No Account button")
        account.tap()
        let fields = app.descendants(matching: .any).matching(NSPredicate(format: "placeholderValue == %@", "Transcription prompt"))
        for _ in 0..<6 where !fields.firstMatch.exists || !fields.firstMatch.isHittable { app.swipeUp() }
        XCTAssertTrue(fields.firstMatch.exists, "No transcription prompt in Account")
        return fields.firstMatch
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
