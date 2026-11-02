import XCTest

final class LoginUITests: XCTestCase {
    private func launch() -> XCUIApplication {
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/login-responses.json")
        let app = XCUIApplication()
        app.launchArguments = ["-preview-login", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()
        XCTAssertTrue(app.buttons["login.apple"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["login.google"].exists)
        return app
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testEmailCodeCanRetryAndChangeAddress() {
        let app = launch()
        capture("Login entry")
        XCTAssertTrue(app.textFields["login.email"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["login.submit"].isEnabled)
        let email = app.textFields["login.email"]
        email.tap()
        email.typeText("alex@example.com")
        app.buttons["login.submit"].tap()
        let code = app.textFields["login.code"]
        XCTAssertTrue(code.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["login.google"].exists)
        capture("Email verification")
        code.tap()
        code.typeText("123")
        code.typeText(XCUIKeyboardKey.delete.rawValue)
        XCTAssertEqual(code.value as? String, "12")
        code.typeText("3456")
        XCTAssertEqual(code.value as? String, "123456")
        capture("Six-digit code entered")
        app.buttons["login.submit"].tap()
        XCTAssertTrue(app.staticTexts["login.error"].waitForExistence(timeout: 5))
        XCTAssertTrue(code.exists)
        app.swipeUp()
        app.buttons["login.change-email"].tap()
        XCTAssertTrue(email.waitForExistence(timeout: 5))
        XCTAssertEqual(email.value as? String, "alex@example.com")
        XCTAssertTrue(app.buttons["login.submit"].exists)
    }

    func testVerificationBackPreservesEmail() {
        let app = launch()
        let email = app.textFields["login.email"]
        email.tap()
        email.typeText("alex@example.com")
        app.buttons["login.submit"].tap()
        XCTAssertTrue(app.textFields["login.code"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.secureTextFields.firstMatch.exists)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(email.waitForExistence(timeout: 5))
        XCTAssertEqual(email.value as? String, "alex@example.com")
    }

    func testPasswordIsASecondaryPathOnTheSameScreen() {
        let app = launch()
        let toggle = app.buttons["login.password"]
        XCTAssertTrue(toggle.exists)
        XCTAssertFalse(app.secureTextFields["login.password-field"].exists)
        let email = app.textFields["login.email"]
        email.tap()
        email.typeText("review@example.com")
        if !toggle.isHittable { app.swipeUp() }
        toggle.tap()
        let password = app.secureTextFields["login.password-field"]
        XCTAssertTrue(password.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["login.submit"].isEnabled)
        password.tap()
        password.typeText("not-the-password")
        capture("Login — password path")
        app.buttons["login.submit"].tap()
        XCTAssertTrue(app.staticTexts["login.error"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["login.code"].exists)
        if !toggle.isHittable { app.swipeUp() }
        toggle.tap()
        XCTAssertFalse(password.exists)
        XCTAssertEqual(email.value as? String, "review@example.com")
    }

    func testProviderButtonsAndEmailAreReachable() {
        let app = launch()
        capture("Login entry")
        XCTAssertTrue(app.buttons["login.google"].isHittable)
        XCTAssertFalse(app.buttons["login.email-option"].exists)
        let email = app.textFields["login.email"]
        if !email.isHittable { app.swipeUp() }
        XCTAssertTrue(email.waitForExistence(timeout: 5))
        XCTAssertTrue(email.isHittable)
        capture("Login — email controls")
    }
}
