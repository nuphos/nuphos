import XCTest

/// A Bot someone else owns and shared with the viewer is listed in Bots, as on
/// Desktop (#3852). The server returns it only for `scope=shared`.
final class SharedBotsUITests: XCTestCase {
    private var live: URL!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "shared-bots-live-\(UUID().uuidString).json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        let bot: [String: Any] = [
            "sessionId": "bot-shared", "teamId": "64b5f1c2e4b0a1d2c3e4f5a6", "title": "Shared Bot", "firstMessage": "Shared Bot",
            "messageCount": 2, "createdAt": "2026-11-03T08:00:00Z", "lastActiveAt": "2026-11-03T09:00:00Z",
            "isOwner": false, "readOnly": false, "agentRuntime": "claude-code", "avatar": "07-ada",
            "runtimeId": "11111111-1111-4111-8111-111111111111", "runtimeLabel": "Preview Codex",
            "activitySeq": 1, "readSeq": 1,
        ]
        func page(_ rows: [[String: Any]]) -> [String: Any] {
            ["status": 200, "body": ["conversations": rows, "parents": [], "nextCursor": NSNull(), "hasMore": false]]
        }
        responses["GET /agent/conversations"] = page([])
        responses["GET /agent/conversations?scope=mine"] = page([])
        responses["GET /agent/conversations?kind=channel"] = page([])
        responses["GET /agent/conversations?scope=shared"] = page([bot])
        responses["GET /agent/conversations?pendingDecision=true"] = page([])
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testABotSharedWithYouIsListed() {
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        XCTAssertTrue(app.staticTexts["Shared Bot"].firstMatch.waitForExistence(timeout: 10), "A Bot shared with you is not in Bots")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "shared-bot"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
