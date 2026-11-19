import XCTest

/// #3959: a just-added runtime's sign-in starts as soon as its computer answers for it, and a
/// removed one ends the wait, instead of "Starting your runtime…" for minutes.
/// Uses a copy of the Runtimes fixture with one computer and no runtimes.
final class NewRuntimeSignInUITests: XCTestCase {
    private let teamId = "64b5f1c2e4b0a1d2c3e4f5a6"
    private let runtimeId = "local_507f1f77bcf86cd799439011_box-1_claude-code_inst-1"
    private var live: URL!
    private var responses: [String: Any] = [:]

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/runtimes-desktop-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "new-runtime-sign-in-live-\(UUID().uuidString).json")
        responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        responses["GET /agent/devices"] = ["status": 200, "body": ["devices": [
            ["deviceId": "box-1", "label": "Mac mini", "access": "owner", "online": true, "metricsStatus": "offline", "metrics": NSNull()],
        ]]]
        responses["GET /teams/\(teamId)/agent-runtimes"] = ["status": 200, "body": ["runtimes": []]]
        responses["POST /agent/devices/box-1/agents"] = ["status": 201, "body": ["instanceId": "inst-1", "runtimeId": runtimeId, "label": "Claude Code"]]
        let login: [String: Any] = ["attemptId": "attempt-1", "state": "awaiting_authorization", "authorizationUrl": "https://claude.ai/oauth/authorize?code=true"]
        responses["POST /teams/\(teamId)/agent-runtimes/\(runtimeId)/login"] = ["status": 202, "body": login]
        responses["GET /teams/\(teamId)/agent-runtimes/\(runtimeId)/login"] = ["status": 200, "body": login]
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    /// Until its first sign-in the backend answers a just-added runtime's status with
    /// `runtime_login_required`: the runtime is there, waiting for this very sign-in.
    func testAJustAddedRuntimeSignsInOnceItsComputerAnswers() throws {
        status(409, code: "runtime_login_required", message: "Sign in to Claude Code on the computer running this agent before it can run conversations.")
        let app = try signIn()

        let page = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "then come back here")).firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 20), "The sign-in did not start for a runtime that only needs it")
        XCTAssertFalse(app.staticTexts["Starting your runtime…"].exists)
    }

    func testARemovedRuntimeEndsTheWaitWithAnError() throws {
        status(404, code: "runtime_not_found", message: "This agent runtime no longer exists.")
        let app = try signIn()

        let gone = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "no longer available")).firstMatch
        XCTAssertTrue(gone.waitForExistence(timeout: 20), "A removed runtime keeps waiting")
        XCTAssertTrue(app.buttons["Try Again"].exists || app.buttons["Sign In"].exists, "No way to try again")
    }

    // MARK: - Helpers

    private func status(_ code: Int, code error: String, message: String) {
        responses["GET /teams/\(teamId)/agent-runtimes/\(runtimeId)/status"] = ["status": code, "body": ["error": ["code": error, "message": message]]]
    }

    /// Adds a Claude Code runtime to the computer and starts its sign-in.
    private func signIn() throws -> XCUIApplication {
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "runtimes"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()

        let add = app.buttons["new-runtime-box-1"]
        XCTAssertTrue(add.waitForExistence(timeout: 30), "The computer offers no New runtime")
        add.tap()
        let provider = app.buttons["provider-claude-code"]
        XCTAssertTrue(provider.waitForExistence(timeout: 5))
        provider.tap()
        let next = app.buttons["Continue"]
        XCTAssertTrue(next.waitForExistence(timeout: 5))
        next.tap()
        let start = app.buttons["Sign In"]
        XCTAssertTrue(start.waitForExistence(timeout: 10), "The new runtime's sign-in did not open")
        start.tap()
        return app
    }
}
