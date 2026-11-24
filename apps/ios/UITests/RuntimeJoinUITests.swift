import XCTest

/// A team with no runtime shows "Connect your first runtime". Once a runtime
/// joins, Home leaves that state on the poll and on a return to the foreground.
/// The fixture is rewritten while the app runs: the app reads it on every request.
final class RuntimeJoinUITests: XCTestCase {
    private let runtimes = "GET /teams/64b5f1c2e4b0a1d2c3e4f5a6/agent-runtimes"
    private let empty = "Connect your first runtime"
    private var live: URL!
    private var responses: [String: Any] = [:]
    private var joined: Any?
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        joined = responses[runtimes]
        let none: [String: Any] = ["status": 200, "body": ["conversations": [], "hasMore": false, "nextCursor": NSNull()]]
        responses["GET /agent/conversations"] = none
        responses["GET /agent/conversations?kind=channel"] = none
        responses[runtimes] = ["status": 200, "body": ["runtimes": []]]
        live = URL.temporaryDirectory.appending(path: "runtime-join-\(UUID()).json")
        try write()
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        XCTAssertTrue(app.staticTexts[empty].waitForExistence(timeout: 12), "No empty state")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testJoinLeavesTheEmptyState() throws {
        try join()
        XCTAssertTrue(app.staticTexts[empty].waitForNonExistence(timeout: 8), "The poll did not read the runtimes")
    }

    func testForegroundLeavesTheEmptyState() throws {
        XCUIDevice.shared.press(.home)
        try join()
        app.activate()
        XCTAssertTrue(app.staticTexts[empty].waitForNonExistence(timeout: 8), "The return did not read the runtimes")
    }

    private func join() throws {
        responses[runtimes] = joined
        try write()
    }

    private func write() throws {
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
    }
}
