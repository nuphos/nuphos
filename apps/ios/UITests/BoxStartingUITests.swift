import XCTest

/// A new account's free Box is still coming up and the team has no runtime yet.
/// Home says the Box is getting ready instead of asking for a computer, and moves
/// to the runtime list by itself once the Box's runtime is listed, without a pull.
/// The fixture is rewritten while the app runs: the app reads it on every request.
final class BoxStartingUITests: XCTestCase {
    private let runtimes = "GET /teams/64b5f1c2e4b0a1d2c3e4f5a6/agent-runtimes"
    private let devices = "GET /agent/devices"
    private let starting = "Free Box is getting ready"
    private var live: URL!
    private var responses: [String: Any] = [:]
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        let none: [String: Any] = ["status": 200, "body": ["conversations": [], "hasMore": false, "nextCursor": NSNull()]]
        responses["GET /agent/conversations"] = none
        responses["GET /agent/conversations?kind=channel"] = none
        responses[runtimes] = ["status": 200, "body": ["runtimes": []]]
        responses[devices] = box(state: "creating", online: false)
        live = URL.temporaryDirectory.appending(path: "box-starting-\(UUID()).json")
        try write()
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testHomeFollowsTheBoxUntilItsRuntimeJoins() throws {
        XCTAssertTrue(app.staticTexts[starting].waitForExistence(timeout: 12), "No getting-ready state")
        XCTAssertFalse(app.staticTexts["Connect your first runtime"].exists, "Asked for a computer while the Box comes up")

        // The Box goes online before its runtime is listed (#4839): Home keeps waiting through it.
        responses[devices] = box(state: "running", online: true)
        try write()
        XCTAssertFalse(app.staticTexts[starting].waitForNonExistence(timeout: 12), "Stopped waiting once the Box was online")

        responses[runtimes] = ["status": 200, "body": ["runtimes": [[
            "id": "22222222-2222-4222-8222-222222222222", "provider": "opencode", "label": "OpenCode on Free Box",
            "status": "active", "kind": "local",
            "local": ["ownerUserId": "u1", "deviceId": "box-1", "deviceLabel": "Free Box", "online": true],
        ]]]]
        try write()
        XCTAssertTrue(app.staticTexts[starting].waitForNonExistence(timeout: 15), "Home did not follow the Box on its own")
        XCTAssertFalse(app.staticTexts["Connect your first runtime"].exists, "Fell back to the empty state")
    }

    private func box(state: String, online: Bool) -> [String: Any] {
        ["status": 200, "body": ["boxAvailable": true, "canCreateBox": false, "devices": [[
            "deviceId": "box-1", "label": "Free Box", "access": "owner", "online": online,
            "metricsStatus": "offline", "metrics": NSNull(), "box": ["state": state],
        ]]]]
    }

    private func write() throws {
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
    }
}
