import XCTest

/// A Stop the runtime refuses is answered with an alert, so it shows while
/// the reader is up in older messages (#1613). Uses a copy of the offline
/// chats fixture with a native runtime conversation that is mid-turn and long
/// enough to scroll.
final class StopRefusedUITests: XCTestCase {
    private let sessionId = "agent-ops"
    private let teamId = "64b5f1c2e4b0a1d2c3e4f5a6"
    private let refusal = "Synthetic cancel failure"
    private var live: URL!
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "stop-refused-live-\(UUID().uuidString).json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        responses["GET /agent/conversations/\(sessionId)"] = ["status": 200, "body": conversation()]
        responses["POST /agent/conversations/\(sessionId)/cancel-runtime"] = [
            "status": 500, "body": ["error": ["message": refusal]],
        ]
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testARefusedStopShowsWhileReadingOlderMessages() throws {
        app = XCUIApplication()
        app.launchArguments = [
            "-preview-home", "-preview-no-push",
            "-open-links", "https://nuphos.ai/teams/\(teamId)/agent/\(sessionId)",
        ]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()

        let transcript = app.collectionViews["chat.transcript"]
        let stop = app.buttons["Stop"].firstMatch
        XCTAssertTrue(transcript.cells.firstMatch.waitForExistence(timeout: 15), "The conversation did not load")
        XCTAssertTrue(stop.waitForExistence(timeout: 10), "Stop is not offered for the running turn")

        // Up into older messages: the status row scrolls away, Stop stays.
        let latest = app.buttons["chat.latest"]
        for _ in 0..<3 where !latest.isHittable { transcript.swipeDown(velocity: .fast) }
        XCTAssertTrue(latest.waitForHittable(true, timeout: 3), "The transcript did not scroll up")
        XCTAssertFalse(visible(refusal), "The refusal is on screen before Stop was tapped")

        stop.tap()

        XCTAssertTrue(waitUntil(timeout: 5) { self.visible(self.refusal) },
                      "A refused Stop showed nothing on screen while reading older messages")
        let alert = app.alerts["Couldn't stop the agent"]
        XCTAssertTrue(alert.exists, "The refusal is not in the Stop alert")
        XCTAssertTrue(alert.staticTexts[refusal].exists, "The alert does not say why")

        // Dismissing it leaves the reader where they were, and Stop still there.
        alert.buttons["OK"].tap()
        XCTAssertFalse(alert.waitForExistence(timeout: 2), "The alert did not close")
        XCTAssertTrue(latest.isHittable, "The reader was moved away from the older messages")
        XCTAssertTrue(stop.isHittable, "Stop is gone although the turn was not stopped")

        // The alert has said it; the end of the transcript does not repeat it.
        latest.tap()
        XCTAssertTrue(latest.waitForHittable(false, timeout: 3), "Scroll to latest did not reach the end")
        XCTAssertFalse(transcript.staticTexts[refusal].exists, "The refusal is also a row at the end")
    }

    // MARK: - Helpers

    /// Whether any element carrying `text` is on screen and not covered.
    private func visible(_ text: String) -> Bool {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", text))
            .allElementsBoundByIndex
            .contains { $0.isHittable }
    }

    private func waitUntil(timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline
        return condition()
    }

    /// A Claude Code conversation in a turn that can be cancelled, with
    /// enough messages to scroll.
    private func conversation() -> [String: Any] {
        let paragraph = "The release checklist covers signing, the TestFlight upload, the changelog and the store screenshots. "
        let messages: [[String: Any]] = (0..<24).map { i in
            [
                "id": "m\(i)",
                "role": i.isMultiple(of: 2) ? "user" : "assistant",
                "parts": [["type": "text", "text": "Message \(i). " + String(repeating: paragraph, count: i.isMultiple(of: 2) ? 1 : 3)]],
                "createdAt": String(format: "2026-11-03T09:%02d:00.000Z", i),
            ]
        }
        return [
            "sessionId": sessionId,
            "title": "Release ops",
            "messages": messages,
            "messagesFirstIndex": 0,
            "messageCount": messages.count,
            "transcriptUpdatedAt": "2026-11-03T09:40:00.000Z",
            "isOwner": true,
            "canManage": true,
            "readOnly": false,
            "agentRuntime": "claude-code",
            "runtimeId": "11111111-1111-4111-8111-111111111111",
            "runtimeLabel": "Preview Codex",
            "runtimeState": [
                "schemaVersion": 2,
                "epoch": "test",
                "revision": 2,
                "state": "active",
                "phase": "running",
                "label": "Running tools…",
                "actions": ["send": true, "cancel": true, "reply": false, "steer": true],
            ],
        ]
    }
}

private extension XCUIElement {
    func waitForHittable(_ hittable: Bool, timeout: TimeInterval) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == %@", NSNumber(value: hittable)), object: self)
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }
}
