import XCTest

/// A Bot someone else owns and shared with the viewer is listed in Bots, as on
/// Desktop, and looks exactly like one of the viewer's own (#3852). The server
/// returns it only for `scope=shared`.
final class SharedBotsUITests: XCTestCase {
    private var live: URL!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "shared-bots-live-\(UUID().uuidString).json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        func bot(_ id: String, _ title: String, at time: String, owner: Bool) -> [String: Any] {
            [
                "sessionId": id, "teamId": "64b5f1c2e4b0a1d2c3e4f5a6", "title": title, "firstMessage": title,
                "messageCount": 2, "createdAt": "2026-11-03T08:00:00Z", "lastActiveAt": "2026-11-03T\(time):00Z",
                "isOwner": owner, "readOnly": false, "agentRuntime": "claude-code", "avatar": "07-ada",
                "runtimeId": "11111111-1111-4111-8111-111111111111", "runtimeLabel": "Preview Codex",
                "activitySeq": 1, "readSeq": 1,
            ]
        }
        func page(_ rows: [[String: Any]]) -> [String: Any] {
            ["status": 200, "body": ["conversations": rows, "parents": [], "nextCursor": NSNull(), "hasMore": false]]
        }
        // One's own Bot is in the history (scope=mine); the shared one only in scope=shared.
        responses["GET /agent/conversations"] = page([])
        responses["GET /agent/conversations?scope=mine"] = page([bot("bot-own", "Own Bot", at: "09:00", owner: true)])
        responses["GET /agent/conversations?kind=channel"] = page([])
        responses["GET /agent/conversations?scope=shared"] = page([bot("bot-shared", "Shared Bot", at: "09:10", owner: false)])
        responses["GET /agent/conversations?pendingDecision=true"] = page([])
        // Only its owner may bring a Bot into a chat, as on the server (#4526).
        responses["POST /agent/channels"] = ["status": 200, "body": ["sessionId": "chat-new"]]
        responses["POST /agent/conversations/chat-new/agents"] = [
            "status": 403, "body": ["error": ["code": "forbidden", "message": "Only its owner can add this agent"]],
        ]
        responses["GET /agent/conversations/bot-shared"] = ["status": 200, "body": bot("bot-shared", "Shared Bot", at: "09:10", owner: false)]
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    /// A Bot shared with you that you have no chat with opens as the Bot's own
    /// conversation. Only its owner may bring it into a new chat, so trying to
    /// make one failed every time and left an empty chat behind (#4526).
    func testABotSharedWithYouOpensWithoutAChat() throws {
        let sent = live.deletingLastPathComponent().appending(path: "shared-bots-sent-\(UUID().uuidString).jsonl")
        defer { try? FileManager.default.removeItem(at: sent) }
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path, "NUPHOS_PREVIEW_REQUESTS": sent.path]
        app.launch()
        let shared = app.staticTexts["Shared Bot"].firstMatch
        XCTAssertTrue(shared.waitForExistence(timeout: 10), "A Bot shared with you is not in Bots")
        shared.tap()
        let own = app.staticTexts["Own Bot"].firstMatch
        let left = NSPredicate(format: "exists == false")
        let opened = XCTWaiter().wait(for: [expectation(for: left, evaluatedWith: own)], timeout: 10) == .completed
        let failure = app.alerts.firstMatch
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "shared-bot-opened"
        shot.lifetime = .keepAlways
        add(shot)
        XCTAssertFalse(failure.exists, "Opening a Bot shared with you failed: \(failure.label)")
        XCTAssertTrue(opened, "A Bot shared with you did not open")
        let requests = (try? String(contentsOf: sent, encoding: .utf8)) ?? ""
        XCTAssertFalse(requests.contains("POST /agent/channels"), "Opening a Bot shared with you made a chat it cannot join")
    }

    func testABotSharedWithYouIsListedLikeYourOwn() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let shared = app.staticTexts["Shared Bot"].firstMatch
        XCTAssertTrue(shared.waitForExistence(timeout: 10), "A Bot shared with you is not in Bots")
        let own = app.staticTexts["Own Bot"].firstMatch
        XCTAssertTrue(own.waitForExistence(timeout: 5), "Your own Bot is not in Bots")
        sleep(1)
        let screenshot = app.screenshot()
        let shot = XCTAttachment(screenshot: screenshot)
        shot.name = "shared-bot"
        shot.lifetime = .keepAlways
        add(shot)
        // The 36 pt face before each title (12 pt apart): the same face on both rows.
        func face(of title: XCUIElement) -> CGRect {
            CGRect(x: title.frame.minX - 12 - 36, y: title.frame.midY - 18, width: 36, height: 36)
        }
        let differing = try differs(screenshot, face(of: shared), face(of: own))
        XCTAssertLessThan(differing, 0.02, "The shared Bot's face differs from your own Bot's")
    }

    /// The share of pixels where some channel differs by more than 32 between two equal-sized rects (points).
    private func differs(_ screenshot: XCUIScreenshot, _ a: CGRect, _ b: CGRect) throws -> Double {
        let image = try XCTUnwrap(screenshot.image.cgImage)
        let scale = CGFloat(image.width) / screenshot.image.size.width
        func pixels(_ rect: CGRect) throws -> [UInt8] {
            let px = CGRect(x: rect.minX * scale, y: rect.minY * scale, width: rect.width * scale, height: rect.height * scale).integral
            let crop = try XCTUnwrap(image.cropping(to: px))
            var data = [UInt8](repeating: 0, count: Int(px.width) * Int(px.height) * 4)
            let context = try XCTUnwrap(CGContext(data: &data, width: Int(px.width), height: Int(px.height), bitsPerComponent: 8,
                                                  bytesPerRow: Int(px.width) * 4, space: CGColorSpaceCreateDeviceRGB(),
                                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(crop, in: CGRect(x: 0, y: 0, width: px.width, height: px.height))
            return data
        }
        let x = try pixels(a), y = try pixels(b)
        XCTAssertEqual(x.count, y.count)
        let count = min(x.count, y.count) / 4
        let changed = (0..<count).filter { i in (0..<3).contains { abs(Int(x[i * 4 + $0]) - Int(y[i * 4 + $0])) > 32 } }.count
        return Double(changed) / Double(max(count, 1))
    }
}
