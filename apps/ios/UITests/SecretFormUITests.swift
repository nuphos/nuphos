import XCTest

/// The secure input card for a website form's details: it names the site, takes each
/// detail in its own masked input, shows them on Reveal, and once sent becomes one line
/// that names the site. Offline fixture; the values go nowhere.
final class SecretFormUITests: XCTestCase {
    func testAFormsDetailsAreTypedRevealedAndSent() {
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/secret-form-responses.json")
        let app = XCUIApplication()
        app.launchArguments = [
            "-preview-home", "-preview-no-push",
            "-open-links", "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/form-details",
        ]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()

        XCTAssertTrue(app.staticTexts["Details needed for www.clinic.example"].waitForExistence(timeout: 15), "The form card did not appear")
        let send = app.buttons["Send securely"]
        XCTAssertFalse(send.isEnabled, "An empty form can be sent")

        let id = app.secureTextFields["National ID number"]
        id.tap()
        id.typeText("A123456789")
        // One detail is not the form.
        XCTAssertFalse(send.isEnabled, "A form with an empty field can be sent")
        let birth = app.secureTextFields["Date of birth (YYYY-MM-DD)"]
        birth.tap()
        birth.typeText("1990-04-12")
        XCTAssertTrue(send.isEnabled, "A filled form cannot be sent")
        XCTAssertFalse(app.staticTexts["A123456789"].exists || app.textFields["National ID number"].exists, "A masked value is shown")
        capture("typed-masked")

        app.buttons["Reveal values"].tap()
        XCTAssertEqual(app.textFields["National ID number"].value as? String, "A123456789")
        XCTAssertEqual(app.textFields["Date of birth (YYYY-MM-DD)"].value as? String, "1990-04-12")
        capture("revealed")

        send.tap()
        XCTAssertTrue(app.staticTexts["www.clinic.example saved on the task's runtime."].waitForExistence(timeout: 10), "The sent card did not become its saved line")
        XCTAssertFalse(app.staticTexts["Details needed for www.clinic.example"].exists, "The sent card still shows its inputs")
        capture("sent")
    }

    /// Attached to the test's result; also written to `FORM_SHOTS` when that names a folder.
    private func capture(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let folder = ProcessInfo.processInfo.environment["FORM_SHOTS"] {
            try? screenshot.pngRepresentation.write(to: URL(filePath: folder).appending(path: "\(name).png"))
        }
    }
}
