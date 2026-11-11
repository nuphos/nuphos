import XCTest

/// Account's transcription prompt shows the default while none has been
/// saved, with nothing to reset.
final class VoicePromptUITests: XCTestCase {
    func testShowsTheDefaultUntilEdited() {
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launch()
        let account = app.buttons["Account"].firstMatch
        XCTAssertTrue(account.waitForExistence(timeout: 10), "No Account button")
        account.tap()
        let field = app.descendants(matching: .any).matching(identifier: "voice.prompt").firstMatch
        for _ in 0..<6 where !field.exists || !field.isHittable { app.swipeUp() }
        XCTAssertTrue(field.exists, "No transcription prompt in Account")

        XCTAssertEqual(field.value as? String, "Nuphos, Claude Code, Codex, GitHub, Linear, Slack, Discord.")
        XCTAssertFalse(app.buttons["Reset prompt"].exists)
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "default"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
