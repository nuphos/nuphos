import XCTest

/// Offline (#3967): a Bot whose Claude account Anthropic holds offers its owner
/// Verify with Anthropic first, then Switch runtime, then Retry.
final class ChannelVerifyAccountUITests: XCTestCase {
    func testHeldAccountOffersVerifyFirst() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        var detail = try XCTUnwrap(responses["GET /agent/conversations/chat-release"] as? [String: Any])
        var body = try XCTUnwrap(detail["body"] as? [String: Any])
        body["messages"] = [[
            "id": "ask", "role": "user", "createdAt": "2026-11-20T05:00:00Z",
            "parts": [["type": "text", "text": "Can you check the release notes?"]],
            "metadata": ["version": 1, "sentAt": "2026-11-20T05:00:00Z",
                         "sender": ["type": "user", "id": "507f1f77bcf86cd799439011", "displayName": "Bruce Wayne"]],
        ]]
        body["messageCount"] = 1
        body["timelineEvents"] = [[
            "kind": "agent_reply_failed", "at": "2026-11-20T05:00:05Z", "agentId": "agent-ops", "cause": "usage_limit",
            "text": "Release ops couldn’t reply: its Claude Code account must be verified with Anthropic.",
            "verifyUrl": "https://portal.anthropic.com/verify",
        ]]
        detail["body"] = body
        responses["GET /agent/conversations/chat-release"] = detail
        let live = FileManager.default.temporaryDirectory.appending(path: "verify-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: live) }
        try JSONSerialization.data(withJSONObject: responses).write(to: live)

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent", "-open-links",
            "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/chat-release",
            "-AppleInterfaceStyle", "Light"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()

        let verify = app.buttons["chat.verifyAccount"]
        XCTAssertTrue(verify.waitForExistence(timeout: 15))
        // The channel slides in over the list: shoot once the row is on screen.
        let onScreen = expectation(for: NSPredicate(format: "isHittable == true"), evaluatedWith: verify)
        wait(for: [onScreen], timeout: 10)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Verify with Anthropic · light"
        shot.lifetime = .keepAlways
        add(shot)

        let switchRuntime = app.buttons["chat.switchAgent"]
        let retry = app.buttons["chat.retryReply"]
        XCTAssertTrue(switchRuntime.exists && retry.exists)
        XCTAssertLessThan(verify.frame.minX, switchRuntime.frame.minX)
        XCTAssertLessThan(switchRuntime.frame.minX, retry.frame.minX)
    }
}
