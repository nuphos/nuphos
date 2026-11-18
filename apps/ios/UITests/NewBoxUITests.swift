import XCTest

/// A team administrator with no computer makes a Box from the app, as on Desktop's Add
/// computer: from the empty state, Create computer, Starting while it comes up, then its
/// runtimes to sign in. The plan's refusal shows the server's own sentence. Uses a copy of
/// the offline Runtimes fixture, rewritten while the app runs.
final class NewBoxUITests: XCTestCase {
    private static let team = "64b5f1c2e4b0a1d2c3e4f5a6"
    private static let refusal = "Your team's plan doesn't include cloud computers. Choose a computer plan to start one."
    private var live: URL!
    private var responses: [String: Any] = [:]
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/runtimes-desktop-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "new-box-live-\(UUID().uuidString).json")
        responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        // A new account: no runtime, no computer, and a deployment that makes Boxes.
        responses["GET /teams/\(Self.team)/agent-runtimes"] = ["status": 200, "body": ["runtimes": []]]
        responses["GET /agent/conversations"] = ["status": 200, "body": ["conversations": [], "hasMore": false]]
        devices([])
        try write()
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testCreatesABoxFromTheEmptyStateAndOffersItsRuntimes() throws {
        // Held long enough to list the Box, as the backend does once it answers.
        responses["POST /agent/devices/boxes"] = [
            "status": 201, "delayMs": 1500,
            "body": ["deviceId": "box-1", "label": "Computer 1", "box": ["state": "creating"]],
        ]
        try write()
        launch()

        let setUp = app.buttons["Set up a computer"]
        XCTAssertTrue(setUp.waitForExistence(timeout: 15), "No empty state for a new account")
        setUp.tap()
        let newBox = app.buttons["new-box"]
        XCTAssertTrue(newBox.waitForExistence(timeout: 10), "Connect a computer offers no Box to an administrator")
        newBox.tap()

        XCTAssertTrue(app.staticTexts["Leave it empty to call it Computer 1."].waitForExistence(timeout: 5))
        // The backend lists the Box by the time it answers the create.
        devices([["deviceId": "box-1", "label": "Computer 1", "access": "owner", "box": ["state": "creating"], "metricsStatus": "offline", "metrics": NSNull()]])
        try write()
        let create = app.buttons["Create computer"]
        XCTAssertTrue(create.waitForExistence(timeout: 5))
        create.tap()
        XCTAssertTrue(app.buttons["Creating…"].waitForExistence(timeout: 2), "No sign of creating")

        let starting = app.staticTexts["Starting the computer and its runtimes, usually 10 to 30 seconds…"]
        XCTAssertTrue(starting.waitForExistence(timeout: 10), "The new Box is not shown starting")

        // Its runtime joins the team.
        responses["GET /teams/\(Self.team)/agent-runtimes"] = ["status": 200, "body": ["runtimes": [[
            "id": "local_507f1f77bcf86cd799439011_box-1", "provider": "claude-code", "label": "Claude Code in Computer 1",
            "status": "active", "kind": "local",
            "local": ["ownerUserId": "507f1f77bcf86cd799439011", "deviceId": "box-1", "deviceLabel": "Computer 1", "online": true, "signedIn": false],
        ]]]]
        try write()
        XCTAssertTrue(app.staticTexts["Your computer is running. Choose a runtime to sign in."].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Claude Code"].exists, "The Box's runtime is not offered to sign in")
    }

    func testAFailedListReadKeepsTheNewBoxStarting() throws {
        responses["POST /agent/devices/boxes"] = ["status": 201, "body": ["deviceId": "box-1", "label": "Computer 1", "box": ["state": "creating"]]]
        try write()
        launch()

        let setUp = app.buttons["Set up a computer"]
        XCTAssertTrue(setUp.waitForExistence(timeout: 15))
        setUp.tap()
        let newBox = app.buttons["new-box"]
        XCTAssertTrue(newBox.waitForExistence(timeout: 10))
        newBox.tap()
        // Every read of the device list fails from here on, so the new Box is never listed.
        responses["GET /agent/devices"] = ["status": 500, "body": ["error": ["message": "Internal error"]]]
        try write()
        let create = app.buttons["Create computer"]
        XCTAssertTrue(create.waitForExistence(timeout: 5))
        create.tap()

        let starting = app.staticTexts["Starting the computer and its runtimes, usually 10 to 30 seconds…"]
        XCTAssertTrue(starting.waitForExistence(timeout: 10), "An unlisted Box is not shown starting")
        Thread.sleep(forTimeInterval: 3)
        XCTAssertTrue(starting.exists, "A failed read ended the wait")
        XCTAssertFalse(app.staticTexts["The computer could not start. Delete it on the Runtimes page and try again."].exists)

        // The polling goes on, so the Box's runtime still shows once it joins.
        responses["GET /teams/\(Self.team)/agent-runtimes"] = ["status": 200, "body": ["runtimes": [[
            "id": "local_507f1f77bcf86cd799439011_box-1", "provider": "claude-code", "label": "Claude Code in Computer 1",
            "status": "active", "kind": "local",
            "local": ["ownerUserId": "507f1f77bcf86cd799439011", "deviceId": "box-1", "deviceLabel": "Computer 1", "online": true, "signedIn": false],
        ]]]]
        try write()
        XCTAssertTrue(app.staticTexts["Your computer is running. Choose a runtime to sign in."].waitForExistence(timeout: 10))
    }

    func testThePlansRefusalShowsTheServersSentence() throws {
        responses["POST /agent/devices/boxes"] = ["status": 402, "body": ["error": ["code": "box_vcpu_limit", "message": Self.refusal]]]
        try write()
        launch()

        let setUp = app.buttons["Set up a computer"]
        XCTAssertTrue(setUp.waitForExistence(timeout: 15), "No empty state for a new account")
        setUp.tap()
        let newBox = app.buttons["new-box"]
        XCTAssertTrue(newBox.waitForExistence(timeout: 10), "Connect a computer offers no Box to an administrator")
        newBox.tap()
        let create = app.buttons["Create computer"]
        XCTAssertTrue(create.waitForExistence(timeout: 5))
        create.tap()

        let paywall = app.alerts["Choose a computer plan"]
        XCTAssertTrue(paywall.waitForExistence(timeout: 10), "The plan's refusal is not the paywall")
        XCTAssertTrue(paywall.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", Self.refusal)).firstMatch.exists,
                      "The paywall does not say the server's sentence")
    }

    func testAMemberIsNotOfferedABox() throws {
        devices([], canCreate: false)
        try write()
        launch()

        let setUp = app.buttons["Set up a computer"]
        XCTAssertTrue(setUp.waitForExistence(timeout: 15))
        setUp.tap()
        XCTAssertTrue(app.staticTexts["Connect a computer"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["new-box"].exists, "A member is offered a Box the backend would refuse")
    }

    private func launch() {
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
    }

    private func devices(_ list: [[String: Any]], canCreate: Bool = true) {
        responses["GET /agent/devices"] = ["status": 200, "body": ["boxAvailable": true, "canCreateBox": canCreate, "devices": list]]
    }

    private func write() throws {
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
    }
}
