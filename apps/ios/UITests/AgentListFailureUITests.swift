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
        let alert = app.alerts["Couldn't save the change"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "The failure was not reported")
        XCTAssertTrue(alert.staticTexts["Synthetic write failure"].exists)
        XCTAssertFalse(app.staticTexts["Couldn't load Bots and tasks"].exists, "The list was replaced")
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
        let alert = app.alerts["Couldn't refresh the list"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "The failed read was not reported")
        XCTAssertFalse(app.staticTexts["Couldn't load Bots and tasks"].exists, "The list was replaced")
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
        launch()
        try unwatch()

        // The first write has already read its answer. A second one would get this.
        try respond(watch, status: 500, body: ["error": ["message": "Sent twice"]])
        try unwatch()
        XCTAssertFalse(app.alerts["Couldn't save the change"].waitForExistence(timeout: 14), "A second Unwatch was sent")
    }

    func testAFailureFromTheLastWorkspaceDoesNotShowInTheNextOne() throws {
        try assertNoStaleFailure(switches: 1)
    }

    func testAFailureFromTheLastWorkspaceDoesNotShowAfterComingBack() throws {
        try assertNoStaleFailure(switches: 2)
    }

    func testTryAgainReadsAFailedListAgain() throws {
        // An empty list leaves nothing in the launch cache to fall back on.
        let original = try originalList()
        responses[list] = ["status": 200, "body": ["conversations": [], "hasMore": false]]
        launch(page: false)
        XCTAssertTrue(app.staticTexts["No tasks yet"].waitForExistence(timeout: 10), "The empty list did not load")

        try respond(list, status: 500, body: ["error": ["message": "First failure"]])
        launch(page: false)
        XCTAssertTrue(app.staticTexts["Couldn't load Bots and tasks"].waitForExistence(timeout: 10), "The first read should fail")
        XCTAssertTrue(app.staticTexts["First failure"].exists)

        // Polling reads quietly, so only Try again can change the message.
        try respond(list, status: 500, body: ["error": ["message": "Second failure"]])
        app.buttons["Try again"].tap()
        XCTAssertTrue(app.staticTexts["Second failure"].waitForExistence(timeout: 5), "Try again did not read the list")

        responses[list] = original
        try write()
        app.buttons["Try again"].tap()
        XCTAssertTrue(row("Release ops").waitForExistence(timeout: 10), "The list did not come back")
    }

    func testPullToRefreshKeepsTheListWhenItFails() throws {
        launch()
        let original = try originalList()
        try respond(list, status: 500, body: ["error": ["message": "Synthetic read failure"]])
        let window = app.windows.firstMatch
        window.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.3))
            .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.9)))
        let alert = app.alerts["Couldn't refresh the list"]
        XCTAssertTrue(alert.waitForExistence(timeout: 8), "The failed refresh was not reported")
        XCTAssertFalse(app.staticTexts["Couldn't load Bots and tasks"].exists, "The list was replaced")
        responses[list] = original
        try write()
        // A spinner that never stops holds the tap until the app counts as idle, a full minute.
        let tapped = Date()
        alert.buttons["Try again"].tap()
        XCTAssertLessThan(Date().timeIntervalSince(tapped), 30, "The pull's spinner did not stop")
        XCTAssertFalse(alert.waitForExistence(timeout: 2), "The retry failed")
        XCTAssertTrue(row("Release ops").exists)
    }

    // MARK: - Helpers

    /// The write fails only after the workspace has changed.
    private func assertNoStaleFailure(switches: Int) throws {
        var teams = try XCTUnwrap(responses["GET /teams"] as? [String: Any])
        var body = try XCTUnwrap(teams["body"] as? [String: Any])
        var list = try XCTUnwrap(body["teams"] as? [[String: Any]])
        list.append(["id": "64b5f1c2e4b0a1d2c3e4f5a7", "name": "Second workspace", "isOwner": true, "role": "ADMINISTRATOR"])
        body["teams"] = list
        teams["body"] = body
        responses["GET /teams"] = teams
        responses[watch] = ["status": 500, "body": ["error": ["message": "Too late"]], "delayMs": 15000]
        launch()
        try unwatch()
        let names = list.compactMap { $0["name"] as? String }
        for _ in 0..<switches { switchWorkspace(among: names) }
        XCTAssertFalse(app.alerts["Couldn't save the change"].waitForExistence(timeout: 22), "A failure from the last workspace showed")
    }

    private func switchWorkspace(among names: [String]) {
        app.buttons["Account"].firstMatch.tap()
        let picker = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Workspace")).firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 5), "No workspace picker")
        let shown = picker.label + ((picker.value as? String) ?? "")
        picker.tap()
        let next = app.buttons[names.first { !shown.contains($0) } ?? names[0]].firstMatch
        XCTAssertTrue(next.waitForExistence(timeout: 5), "No other workspace")
        next.tap()
        sleep(1)
        let done = app.buttons["Done"].firstMatch
        if done.exists { done.tap() } else { app.swipeDown(velocity: .fast) }
        sleep(1)
    }

    private func launch(page: Bool = true) {
        try? write()
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        guard page else { return }
        XCTAssertTrue(row("Release ops").waitForExistence(timeout: 10), "The list did not load")
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
