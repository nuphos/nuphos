import XCTest

/// Offline: a channel's wake-up on a Task names its newest post in one line that opens the channel.
final class ChannelWakeLineUITests: XCTestCase {
    func testWakeLineNamesTheNewestPost() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/push-responses.json")
        let live = FileManager.default.temporaryDirectory.appending(path: "wake-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: live) }
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        var conversation = try XCTUnwrap(responses["GET /agent/conversations/push-a"] as? [String: Any])
        var body = try XCTUnwrap(conversation["body"] as? [String: Any])
        func say(_ id: String, _ role: String, _ text: String) -> [String: Any] {
            ["id": id, "role": role, "createdAt": "2026-11-16T05:10:00Z", "parts": [["type": "text", "text": text]]]
        }
        let wake: [String: Any] = [
            "id": "wake-1", "role": "user", "createdAt": "2026-11-16T05:12:00Z",
            "parts": [["type": "text", "text": "New messages in a Nuphos channel (channelId c-launch)."]],
            "metadata": ["version": 1, "source": "agent.resource", "sentAt": "2026-11-16T05:12:00Z",
                         "sender": ["type": "system", "id": "channel:c-launch", "displayName": "launch-review"],
                         "channelPost": ["id": "p1", "text": "Staging deploy failed on the migrations step, can you look?", "more": 2,
                                         "sender": ["type": "user", "id": "u1", "displayName": "Mei Chen"]]],
        ]
        body["messages"] = [
            say("m1", "user", "Cut the release once staging is green."),
            say("m2", "assistant", "Done: the migration now runs before the seed step."),
            wake,
            say("m3", "assistant", "Looking at the failed step now."),
        ]
        conversation["body"] = body
        responses["GET /agent/conversations/push-a"] = conversation
        responses["GET /agent/conversations?kind=channel"] = ["status": 200, "body": ["conversations": []]]
        try JSONSerialization.data(withJSONObject: responses).write(to: live)

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent", "-open-links",
            "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/push-a"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let wake = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'launch-review'")).firstMatch
        XCTAssertTrue(wake.waitForExistence(timeout: 10))
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Channel wake line · light"
        shot.lifetime = .keepAlways
        add(shot)

        let line = app.buttons.containing(NSPredicate(format: "label CONTAINS 'Mei Chen'")).firstMatch
        XCTAssertTrue(line.exists)
        XCTAssertGreaterThanOrEqual(line.frame.height, 44)
        XCTAssertTrue(line.staticTexts["+2 more"].exists)
    }
}
