import XCTest

final class LoginUITests: XCTestCase {
    private func launch(fixtureName: String = "login-responses.json") -> XCUIApplication {
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/\(fixtureName)")
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

    func testEmailCodeAutomaticallyVerifiesAndCanRetryAndChangeAddress() {
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
        XCTAssertFalse(app.buttons["login.submit"].isEnabled)
        XCTAssertFalse(app.staticTexts["login.error"].exists)
        code.typeText(XCUIKeyboardKey.delete.rawValue)
        XCTAssertEqual(code.value as? String, "12")
        code.typeText("3456")
        XCTAssertEqual(code.value as? String, "123456")
        capture("Six-digit code entered")
        XCTAssertTrue(app.staticTexts["login.error"].waitForExistence(timeout: 5))
        XCTAssertTrue(code.exists)
        XCTAssertTrue(app.buttons["login.submit"].isEnabled)
        app.swipeUp()
        app.buttons["login.change-email"].tap()
        XCTAssertTrue(email.waitForExistence(timeout: 5))
        XCTAssertEqual(email.value as? String, "alex@example.com")
        XCTAssertTrue(app.buttons["login.submit"].exists)
    }

    func testAddingAccountStartsWithAnEmptyEmailForm() {
        let app = launch(fixtureName: "accounts-responses.json")
        let email = app.textFields["login.email"]
        email.tap()
        email.typeText("alex@example.com")
        app.buttons["login.submit"].tap()
        let code = app.textFields["login.code"]
        XCTAssertTrue(code.waitForExistence(timeout: 5))
        code.tap()
        code.typeText("123456")
        let account = app.buttons["Account"]
        XCTAssertTrue(account.waitForExistence(timeout: 10))
        account.tap()
        app.buttons["Add account"].tap()
        XCTAssertTrue(email.waitForExistence(timeout: 5))
        XCTAssertEqual(email.value as? String, email.placeholderValue)
        XCTAssertFalse(code.exists)
        app.buttons["Cancel adding account"].tap()
        XCTAssertTrue(account.waitForExistence(timeout: 10))
        account.tap()
        app.buttons["Account options for alex@example.com"].tap()
        app.buttons["Sign out"].firstMatch.tap()
        app.sheets.buttons["Sign out"].tap()
        XCTAssertTrue(email.waitForExistence(timeout: 5))
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
