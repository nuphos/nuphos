import XCTest

/// A failed turn's line offers Retry and Copy (#1962). Uses a copy of the
/// offline chats fixture with a native runtime conversation whose last turn
/// failed.
final class TurnRetryUITests: XCTestCase {
    private let sessionId = "agent-ops"
    private let teamId = "64b5f1c2e4b0a1d2c3e4f5a6"
    private let failure = "The agent stopped responding before it finished the turn."
    private var live: URL!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "turn-retry-live-\(UUID().uuidString).json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        responses["GET /agent/conversations/\(sessionId)"] = ["status": 200, "body": conversation()]
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testAFailedTurnOffersRetryAndCopy() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-preview-home", "-preview-no-push",
            "-open-links", "https://nuphos.ai/teams/\(teamId)/agent/\(sessionId)",
        ]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()

        let transcript = app.collectionViews["chat.transcript"]
        XCTAssertTrue(transcript.cells.firstMatch.waitForExistence(timeout: 15), "The conversation did not load")
        XCTAssertTrue(transcript.staticTexts[failure].waitForExistence(timeout: 10), "The failed turn's line is missing")
        let retry = transcript.buttons["Retry"]
        let copy = transcript.buttons["Copy"]
        XCTAssertTrue(retry.waitForExistence(timeout: 5), "Retry is not offered on the latest failed turn")
        XCTAssertTrue(copy.exists, "Copy is not offered on the failed turn")
        attach(app, "failed-turn-actions")

        copy.tap()
        XCTAssertTrue(transcript.buttons["Copied"].waitForExistence(timeout: 3), "Copy did not confirm")
        attach(app, "failed-turn-copied")
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// A Claude Code conversation whose last turn failed, with the runtime idle.
    private func conversation() -> [String: Any] {
        let messages: [[String: Any]] = [
            ["id": "m0", "role": "user", "createdAt": "2026-11-03T09:00:00.000Z",
             "parts": [["type": "text", "text": "Run the release checklist for 2.4 and post the summary."]]],
            ["id": "m1", "role": "assistant", "createdAt": "2026-11-03T09:00:05.000Z",
             "parts": [
                ["type": "text", "text": "Starting with the signing step."],
                ["type": "turn-interrupted", "id": "int-1", "reason": "error", "message": failure,
                 "createdAt": "2026-11-03T09:02:00.000Z"],
             ]],
        ]
        return [
            "sessionId": sessionId,
            "title": "Release ops",
            "messages": messages,
            "messagesFirstIndex": 0,
            "messageCount": messages.count,
            "transcriptUpdatedAt": "2026-11-03T09:02:00.000Z",
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
                "phase": "idle",
                "label": "Ready",
                "actions": ["send": true, "cancel": false, "reply": false, "steer": false],
            ],
        ]
    }
}
