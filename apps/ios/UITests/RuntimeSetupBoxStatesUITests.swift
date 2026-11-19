import XCTest

/// Runtime setup says why it offers no Box, as Desktop does (#3953): a member is
/// told only administrators rent one, and a failed read says so and can read again.
/// Uses a copy of the offline chats fixture with its own `GET /agent/devices`.
final class RuntimeSetupBoxStatesUITests: XCTestCase {
    private var live: URL!
    private var responses: [String: Any] = [:]

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "runtime-setup-box-live-\(UUID().uuidString).json")
        responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    /// The preview transport reads the file on every request, so a test can change an answer mid-run.
    private func devices(_ answer: [String: Any]) throws {
        responses["GET /agent/devices"] = answer
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
    }

    private func openGuide() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "runtimes"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let add = app.buttons["Add computer"].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 10), "Computers & runtimes did not open")
        add.tap()
        XCTAssertTrue(app.staticTexts["Connect a computer"].waitForExistence(timeout: 10), "Runtime setup did not open")
        return app
    }

    func testAMemberIsToldOnlyAdministratorsRentOne() throws {
        try devices(["status": 200, "body": ["boxAvailable": true, "canCreateBox": false, "devices": []]])
        let app = openGuide()
        XCTAssertTrue(app.staticTexts["Administrators rent computers from Nuphos."].waitForExistence(timeout: 10),
                      "A member is not told why there is no Box")
        XCTAssertFalse(app.buttons["new-box"].exists, "A member is offered a Box")
        shot(app, "member")
    }

    func testAFailedReadSaysSoAndTryAgainReadsAgain() throws {
        try devices(["status": 500, "body": ["error": ["message": "Synthetic failure"]]])
        let app = openGuide()
        let failed = app.staticTexts["Could not load computers."]
        XCTAssertTrue(failed.waitForExistence(timeout: 10), "A failed read says nothing")
        XCTAssertFalse(app.staticTexts["Administrators rent computers from Nuphos."].exists, "A failed read blames the role")
        shot(app, "failed-read")
        try devices(["status": 200, "body": ["boxAvailable": true, "canCreateBox": true, "devices": []]])
        app.buttons["Try again"].firstMatch.tap()
        XCTAssertTrue(app.buttons["new-box"].waitForExistence(timeout: 10), "Try again did not read the list again")
        XCTAssertFalse(failed.exists, "The failure stays after a good read")
        shot(app, "after-try-again")
    }

    func testADeploymentWithoutBoxesSaysNothingAboutThem() throws {
        try devices(["status": 200, "body": ["boxAvailable": false, "canCreateBox": false, "devices": []]])
        let app = openGuide()
        XCTAssertTrue(app.links["Visit Nuphos"].waitForExistence(timeout: 10) || app.buttons["Visit Nuphos"].waitForExistence(timeout: 2))
        XCTAssertFalse(app.staticTexts["Administrators rent computers from Nuphos."].exists, "A deployment without Boxes mentions renting one")
        XCTAssertFalse(app.staticTexts["Could not load computers."].exists)
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
