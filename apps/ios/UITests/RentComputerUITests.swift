import XCTest

/// Add computer names the Box option as Desktop does (#3650): one name for one
/// thing in both apps. Uses a copy of the offline chats fixture where a Box can be made.
final class RentComputerUITests: XCTestCase {
    private var live: URL!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "rent-computer-live-\(UUID().uuidString).json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        responses["GET /agent/devices"] = ["status": 200, "body": ["boxAvailable": true, "canCreateBox": true, "devices": []]]
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testTheBoxOptionHasDesktopsName() {
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "runtimes"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let add = app.buttons["Add computer"].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 10), "Computers & runtimes did not open")
        add.tap()
        let option = app.staticTexts["Rent a computer from Nuphos"].firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 10), "The Box option is not named as on Desktop")
        XCTAssertTrue(app.staticTexts["Nuphos runs it for you, with Claude Code, Codex, OpenCode and more."].exists,
                      "The Box option is not described as on Desktop")
        shot("1-add-computer")
        option.tap()
        XCTAssertTrue(app.navigationBars["Rent a computer from Nuphos"].waitForExistence(timeout: 10), "The form is not titled as on Desktop")
        // Too long for a query by label: found by its start, then compared whole.
        let form = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "A Linux computer Nuphos runs")).firstMatch
        XCTAssertTrue(form.exists, "The form is not described as on Desktop")
        XCTAssertEqual(form.label, "A Linux computer Nuphos runs, with Claude Code, Codex, OpenCode and more on it. Running computers count against your plan's vCPU; paused ones do not.")
        shot("2-form")
    }

    private func shot(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
