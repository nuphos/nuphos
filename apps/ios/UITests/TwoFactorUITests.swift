import XCTest

/// Two-factor authentication on offline fixtures: the sign-in's second step,
/// turning it on from the account sheet, and the step-up prompt.
final class TwoFactorUITests: XCTestCase {
    private func launch(_ arguments: [String], fixture: String) -> XCUIApplication {
        let path = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/\(fixture)")
        let app = XCUIApplication()
        app.launchArguments = arguments + ["-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": path.path]
        app.launch()
        return app
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func openTwoFactor(_ app: XCUIApplication) {
        XCTAssertTrue(app.buttons["Account"].waitForExistence(timeout: 15))
        app.buttons["Account"].tap()
        let row = app.buttons["Two-factor authentication"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
    }

    func testASignInThatNeedsACodeAsksForIt() {
        let app = launch(["-preview-login"], fixture: "mfa-responses.json")
        let email = app.textFields["login.email"]
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        email.tap()
        email.typeText("alex@example.com")
        app.buttons["login.submit"].tap()
        let code = app.textFields["login.code"]
        XCTAssertTrue(code.waitForExistence(timeout: 5))
        code.tap()
        code.typeText("123456")
        XCTAssertTrue(app.textFields["mfa.code"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Use a recovery code"].exists)
        capture("Sign-in second step")
    }

    func testTurningItOnShowsTheKeyThenTheRecoveryCodes() {
        let app = launch(["-preview-home"], fixture: "mfa-responses.json")
        openTwoFactor(app)
        XCTAssertTrue(app.buttons["Turn on"].waitForExistence(timeout: 5))
        capture("Two-factor off")
        app.buttons["Turn on"].tap()
        let code = app.textFields["mfa.code"]
        XCTAssertTrue(code.waitForExistence(timeout: 5))
        capture("Two-factor setup")
        code.tap()
        code.typeText("123456")
        XCTAssertTrue(app.staticTexts["k7mw-3pqa-x9tr-h2cn"].waitForExistence(timeout: 5))
        capture("Recovery codes")
    }

    func testAnActionThatNeedsACodeAsksBeforeRetrying() {
        let app = launch(["-preview-home"], fixture: "mfa-on-responses.json")
        openTwoFactor(app)
        XCTAssertTrue(app.buttons["Turn off"].waitForExistence(timeout: 5))
        capture("Two-factor on")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["Signed-in devices"].tap()
        XCTAssertTrue(app.navigationBars["Confirm it’s you"].waitForExistence(timeout: 5))
        capture("Step-up prompt")
    }
}
