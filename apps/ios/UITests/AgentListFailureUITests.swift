import XCTest

/// A failed row action keeps the Agents list on screen, offers a retry, and the
/// list keeps polling. Uses a copy of the offline chats fixture, rewritten while
/// the app runs: the app reads it again on every request.
final class AgentListFailureUITests: XCTestCase {
    private let list = "GET /agent/conversations"
    private let watch = "DELETE /agent/conversations/agent-ops/watch"
    private var live: URL!
    private var responses: [String: Any] = [:]
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "agent-list-failure-live-\(UUID().uuidString).json")
        responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        try updateRow(["watching": true])
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testFailedWriteKeepsTheListAndRetries() throws {
        try respond(watch, status: 500, body: ["error": ["message": "Synthetic write failure"]])
        launch()

        try unwatch()
        let alert = app.alerts["Couldn't update agent"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "The failure was not reported")
        XCTAssertTrue(alert.staticTexts["Synthetic write failure"].exists)
        XCTAssertFalse(app.staticTexts["Couldn't load agents"].exists, "The list was replaced")
        XCTAssertTrue(row("Release ops").exists, "The row is gone")

        // Trying again repeats the write, which now works.
        try respond(watch, status: 200, body: ["ok": true])
        try updateRow(["watching": false])
        alert.buttons["Try again"].tap()
        XCTAssertFalse(alert.waitForExistence(timeout: 2), "The retry failed")
        try assertMenu(shows: "Watch")
    }

    func testFailedReadKeepsTheRowsAndTheListKeepsPolling() throws {
        try respond(watch, status: 200, body: ["ok": true])
        launch()

        try respond(list, status: 500, body: ["error": ["message": "Synthetic read failure"]])
        try unwatch()
        let alert = app.alerts["Couldn't refresh agents"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "The failed read was not reported")
        XCTAssertFalse(app.staticTexts["Couldn't load agents"].exists, "The list was replaced")
        alert.buttons["OK"].tap()
        XCTAssertTrue(row("Release ops").exists, "The row is gone")
        try assertMenu(shows: "Watch")

        // The poll carries on: a row renamed elsewhere shows up without a touch.
        responses[list] = try originalList()
        try updateRow(["watching": false, "title": "Renamed elsewhere"])
        XCTAssertTrue(row("Renamed elsewhere").waitForExistence(timeout: 10), "The list stopped polling")
    }

    func testAWriteOnItsWayCannotBeRepeated() throws {
        responses[watch] = ["status": 200, "body": ["ok": true], "delayMs": 6000]
        try write()
        launch()

        try unwatch()
        let cell = row("Release ops")
        cell.swipeLeft()
        let item = app.buttons["Unwatch"].firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 3))
        XCTAssertFalse(item.isEnabled, "A second Unwatch could be sent")
    }

    func testTryAgainReadsAFailedListAgain() throws {
        let original = try originalList()
        try respond(list, status: 500, body: ["error": ["message": "Synthetic list failure"]])
        launch(page: false)
        let error = app.staticTexts["Couldn't load agents"]
        openAgents()
        XCTAssertTrue(error.waitForExistence(timeout: 10), "The first read should fail")

        responses[list] = original
        try write()
        let again = app.buttons["Try again"]
        if again.exists { again.tap() }
        XCTAssertTrue(row("Release ops").waitForExistence(timeout: 10), "The list did not come back")
    }

    func testPullToRefreshKeepsTheListWhenItFails() throws {
        launch()
        let original = try originalList()
        try respond(list, status: 500, body: ["error": ["message": "Synthetic read failure"]])
        row("Release ops").press(forDuration: 0.05, thenDragTo: app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.9)))
        let alert = app.alerts["Couldn't refresh agents"]
        XCTAssertTrue(alert.waitForExistence(timeout: 8), "The failed refresh was not reported")
        XCTAssertFalse(app.staticTexts["Couldn't load agents"].exists, "The list was replaced")
        responses[list] = original
        try write()
        alert.buttons["Try again"].tap()
        XCTAssertFalse(alert.waitForExistence(timeout: 2), "The retry failed")
        XCTAssertTrue(row("Release ops").exists)
    }

    // MARK: - Helpers

    private func launch(page: Bool = true) {
        try? write()
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        guard page else { return }
        openAgents()
        XCTAssertTrue(row("Release ops").waitForExistence(timeout: 10), "The list did not load")
    }

    private func openAgents() {
        let agents = app.buttons["Agents"].firstMatch
        if agents.waitForExistence(timeout: 10) { agents.tap() }
    }

    private func row(_ title: String) -> XCUIElement {
        app.staticTexts[title].firstMatch
    }

    private func unwatch() throws {
        row("Release ops").swipeLeft()
        let item = app.buttons["Unwatch"].firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 3), "No Unwatch on the row")
        item.tap()
    }

    private func assertMenu(shows title: String) throws {
        row("Release ops").swipeLeft()
        XCTAssertTrue(app.buttons[title].firstMatch.waitForExistence(timeout: 5), "The row does not offer \(title)")
        row("Check the staging cluster").tap()
    }

    private func originalList() throws -> [String: Any] {
        ["status": 200, "body": try listBody()]
    }

    private func listBody() throws -> [String: Any] {
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        let original = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        var entry = try XCTUnwrap(original[list] as? [String: Any])
        var body = try XCTUnwrap(entry["body"] as? [String: Any])
        body["conversations"] = try XCTUnwrap(body["conversations"] as? [[String: Any]]).map {
            $0["sessionId"] as? String == "agent-ops" ? $0.merging(["watching": true]) { $1 } : $0
        }
        entry["body"] = body
        return body
    }

    private func updateRow(_ fields: [String: Any]) throws {
        var entry = responses[list] as? [String: Any] ?? ["status": 200]
        var body = try (entry["body"] as? [String: Any]) ?? listBody()
        if body["conversations"] == nil { body = try listBody() }
        body["conversations"] = try XCTUnwrap(body["conversations"] as? [[String: Any]]).map {
            $0["sessionId"] as? String == "agent-ops" ? $0.merging(fields) { $1 } : $0
        }
        entry["status"] = 200
        entry["body"] = body
        responses[list] = entry
        try write()
    }

    private func respond(_ key: String, status: Int, body: [String: Any]) throws {
        responses[key] = ["status": status, "body": body]
        try write()
    }

    private func write() throws {
        let data = try JSONSerialization.data(withJSONObject: responses)
        try data.write(to: live, options: .atomic)
    }
}
