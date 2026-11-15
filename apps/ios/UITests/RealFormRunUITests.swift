import XCTest

/// Local only: the form card against a real backend on this computer. The Desktop app has
/// already started the Task and its agent has asked; this signs in on the phone, fills the
/// card in and sends it. Every step is captured, since the screens between are not fixtures.
final class RealFormRunUITests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment

    func testTheCardIsAnsweredAgainstARealBackend() throws {
        guard let api = env["FORM_API"], let email = env["FORM_EMAIL"], let log = env["FORM_LOG"], let marker = env["FORM_MARKER"] else {
            throw XCTSkip("Needs a local stack")
        }
        let app = XCUIApplication()
        app.launchArguments = ["-apiBaseURL", api]
        addUIInterruptionMonitor(withDescription: "System alert") { alert in
            for label in ["Don’t Allow", "Don't Allow", "Not Now", "Cancel"] where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            return false
        }
        app.launch()

        let field = app.textFields["login.email"]
        XCTAssertTrue(field.waitForExistence(timeout: 20), "No sign-in form")
        field.tap()
        field.typeText(email)
        app.buttons["login.submit"].tap()
        let code = app.textFields["login.code"]
        XCTAssertTrue(code.waitForExistence(timeout: 10), "No code field")
        // The backend logs the code it would have mailed; the newest one for this address.
        var digits: String?
        for _ in 0..<20 where digits == nil {
            sleep(1)
            let lines = (try? String(contentsOfFile: log, encoding: .utf8))?.split(separator: "\n") ?? []
            digits = lines.last { $0.contains(email) && $0.contains("sign_in_code") }
                .flatMap { $0.firstMatch(of: /"sign_in_code"\s*:\s*"(\d{6})"/) }.map { String($0.1) }
        }
        code.tap()
        code.typeText(try XCTUnwrap(digits, "No sign-in code in the backend log"))
        sleep(6)
        capture("1-signed-in")

        let task = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", marker)).firstMatch
        if !task.waitForExistence(timeout: 20) { capture("no-task") }
        XCTAssertTrue(task.exists, "The Task the Desktop app started is not listed")
        task.tap()
        XCTAssertTrue(app.staticTexts["Details needed for www.clinic.example"].waitForExistence(timeout: 20), "The form card did not appear")
        capture("2-card")

        let id = app.secureTextFields["ID number"]
        id.tap()
        id.typeText("E2E-ID-48213-phone")
        let birth = app.secureTextFields["Date of birth"]
        birth.tap()
        birth.typeText("1990-04-12-phone")
        capture("3-typed")
        app.buttons["Send securely"].tap()
        XCTAssertTrue(app.staticTexts["www.clinic.example saved on the task's runtime."].waitForExistence(timeout: 20), "The card did not become its saved line")
        // The agent's next turn answers the reply by itself.
        let answered = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "ACK E2E_DELIVERY:missing")).firstMatch
        if !answered.waitForExistence(timeout: 40) { capture("no-answer") }
        XCTAssertTrue(answered.exists, "The agent did not carry on after the card")
        capture("4-agent-continued")
    }

    private func capture(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let folder = env["FORM_SHOTS"] {
            try? screenshot.pngRepresentation.write(to: URL(filePath: folder).appending(path: "\(name).png"))
        }
    }
}
