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

    /// A running Box whose host is down lists no runtime by itself, so Home does not wait for it forever.
    func testABoxWhoseHostIsDownIsNotAwaited() throws {
        XCTAssertTrue(app.staticTexts[starting].waitForExistence(timeout: 12), "No getting-ready state")
        responses[devices] = box(state: "running", online: false)
        try write()
        XCTAssertTrue(app.staticTexts["Connect your first runtime"].waitForExistence(timeout: 15), "Kept waiting for a Box whose host is down")
        XCTAssertFalse(app.staticTexts[starting].exists)
    }

    /// The host drops before it lists a runtime, then comes back (#5018): Home lists the runtime on its own.
    func testHomeListsARuntimeThatJoinsAfterTheHostDropped() throws {
        XCTAssertTrue(app.staticTexts[starting].waitForExistence(timeout: 12), "No getting-ready state")
        responses[devices] = box(state: "running", online: false)
        try write()
        let connect = app.staticTexts["Connect your first runtime"]
        XCTAssertTrue(connect.waitForExistence(timeout: 15), "No empty state while the host is down")
        responses[devices] = box(state: "running", online: true)
        responses[runtimes] = runtimeList([opencode])
        try write()
        let left = connect.waitForNonExistence(timeout: 15)
        shot("5018a")
        XCTAssertTrue(left, "Home stayed on the empty state after the runtime joined")
    }

    /// The Box's Codex, not signed in, is listed before its OpenCode (#5018): Create turns on once OpenCode is listed.
    func testCreateTurnsOnWhenASignedInRuntimeJoinsLater() throws {
        XCTAssertTrue(app.staticTexts[starting].waitForExistence(timeout: 12), "No getting-ready state")
        responses[devices] = box(state: "running", online: true)
        responses[runtimes] = runtimeList([codex])
        try write()
        XCTAssertTrue(app.staticTexts[starting].waitForNonExistence(timeout: 15), "Home did not move on to the runtime list")
        let create = app.buttons["Create"]
        XCTAssertTrue(create.waitForExistence(timeout: 5), "No Create button")
        XCTAssertFalse(create.isEnabled, "Create is on with only a runtime that is not signed in")
        responses[runtimes] = runtimeList([codex, opencode])
        try write()
        let on = create.wait(for: \.isEnabled, toEqual: true, timeout: 15)
        shot("5018b")
        XCTAssertTrue(on, "Create stayed off after OpenCode joined")
    }

    private let codex: [String: Any] = [
        "id": "11111111-1111-4111-8111-111111111111", "provider": "codex", "label": "Codex on Free Box",
        "status": "active", "kind": "local",
        "local": ["ownerUserId": "u1", "deviceId": "box-1", "deviceLabel": "Free Box", "online": true, "signedIn": false],
    ]
    private let opencode: [String: Any] = [
        "id": "22222222-2222-4222-8222-222222222222", "provider": "opencode", "label": "OpenCode on Free Box",
        "status": "active", "kind": "local",
        "local": ["ownerUserId": "u1", "deviceId": "box-1", "deviceLabel": "Free Box", "online": true],
    ]

    /// Evidence only: the screen, base64 between markers in the log, and as an attachment.
    private func shot(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        print("EVIDENCE-BEGIN \(name)\n\(png.base64EncodedString())\nEVIDENCE-END \(name)")
        let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func runtimeList(_ list: [[String: Any]]) -> [String: Any] {
        ["status": 200, "body": ["runtimes": list]]
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
