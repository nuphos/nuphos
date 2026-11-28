import XCTest

/// A Task whose waiting turns came from a Trigger or another agent, held by the
/// usage limit, says so above the composer although none of them are this
/// person's (#5355). Offline: a copy of the chats fixture with that queue.
final class UsageHoldNoticeUITests: XCTestCase {
    private let sessionId = "agent-ops"
    private let teamId = "64b5f1c2e4b0a1d2c3e4f5a6"

    func testAHeldQueueOfTriggerFiresSaysWhyTheTaskWaits() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        responses["GET /agent/conversations/\(sessionId)"] = ["status": 200, "body": conversation()]
        responses["GET /agent/conversations/\(sessionId)/queue"] = ["status": 200, "body": [
            "held": ["reason": "usage_limit"],
            "messages": [[
                "id": "fire-1", "source": "agent.resource", "senderUserId": "507f1f77bcf86cd799439011", "mine": false,
                "text": "Check last night's deploy and report anything that failed.",
                "receivedAt": "2026-11-03T09:41:00.000Z",
            ]],
        ]]
        let live = FileManager.default.temporaryDirectory.appending(path: "usage-hold-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: live) }
        try JSONSerialization.data(withJSONObject: responses).write(to: live)

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push",
            "-open-links", "https://nuphos.ai/teams/\(teamId)/agent/\(sessionId)",
            "-AppleInterfaceStyle", "Light"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()

        XCTAssertTrue(app.collectionViews["chat.transcript"].cells.firstMatch.waitForExistence(timeout: 15),
                      "The conversation did not load")
        let notice = app.staticTexts["Out of usage. These run when usage resets."]
        let shown = notice.waitForExistence(timeout: 10)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Usage hold on Trigger fires · light"
        shot.lifetime = .keepAlways
        add(shot)
        XCTAssertTrue(shown, "A Task held by the usage limit shows no notice when the held turns are not mine")
        // The list stays this person's own: a Trigger's fire is not offered to edit or take back.
        XCTAssertFalse(app.buttons["Queued message 1: Check last night's deploy and report anything that failed."].exists,
                       "Someone else's held message is listed as mine")
    }

    /// A Claude Code Task, idle between turns.
    private func conversation() -> [String: Any] {
        let messages: [[String: Any]] = [
            ["id": "m0", "role": "user", "createdAt": "2026-11-03T09:00:00.000Z",
             "parts": [["type": "text", "text": "Every morning, check last night's deploy and report anything that failed."]]],
            ["id": "m1", "role": "assistant", "createdAt": "2026-11-03T09:01:00.000Z",
             "parts": [["type": "text", "text": "Set up. I'll check the deploy each morning and report here."]]],
        ]
        return [
            "sessionId": sessionId,
            "title": "Deploy report",
            "messages": messages,
            "messagesFirstIndex": 0,
            "messageCount": messages.count,
            "transcriptUpdatedAt": "2026-11-03T09:01:00.000Z",
            "isOwner": true,
            "canManage": true,
            "readOnly": false,
            "agentRuntime": "claude-code",
            "runtimeId": "11111111-1111-4111-8111-111111111111",
            "runtimeLabel": "Preview Claude Code",
            "runtimeState": [
                "schemaVersion": 2,
                "epoch": "test",
                "revision": 2,
                "state": "idle",
                "label": "Ready",
                "actions": ["send": true, "cancel": false, "reply": false, "steer": false],
            ],
        ]
    }
}
