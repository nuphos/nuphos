import XCTest

/// The composer is see-through, so the transcript has to end where it starts:
/// a row scrolled under it would show through the draft and the placeholder.
/// Uses a copy of the offline chats fixture with release-planning's posts
/// replaced by a mix of video, words, an image, words and a file.
final class ChatComposerLayoutUITests: XCTestCase {
    func testNothingShowsBehindTheComposer() throws {
        let app = try launch()
        let transcript = app.collectionViews["chat.transcript"]
        let composer = app.descendants(matching: .any)
            .matching(NSPredicate(format: "placeholderValue == 'Message release-planning'")).firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10), "No composer")
        XCTAssertTrue(app.buttons["Open sheet.jpg"].waitForExistence(timeout: 10), "The transcript never loaded")
        sleep(2)
        shot("at-rest")
        // The glass sits above its field, so the field's top bounds the glass's top.
        XCTAssertLessThanOrEqual(transcript.frame.maxY, composer.frame.minY,
                                 "The transcript runs on under the composer: \(transcript.frame) vs \(composer.frame)")
        let middle = transcript.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
        middle.press(forDuration: 0.1, thenDragTo: middle.withOffset(CGVector(dx: 0, dy: 160)))
        sleep(2)
        shot("mid-scroll")
        XCTAssertLessThanOrEqual(transcript.frame.maxY, composer.frame.minY,
                                 "The transcript runs on under the composer after a scroll")
    }

    private func launch() throws -> XCUIApplication {
        let fixtures = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures")
        let live = fixtures.appending(path: "chat-composer-layout-live.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(
            with: Data(contentsOf: fixtures.appending(path: "channel-responses.json"))) as? [String: Any])
        let sender: [String: Any] = ["type": "agent", "id": "agent-ops", "displayName": "Release ops", "agentRuntime": "claude-code"]
        func post(_ id: String, _ minute: Int, _ parts: [[String: Any]]) -> [String: Any] {
            let at = String(format: "2026-11-03T09:%02d:00.000Z", minute)
            return ["id": id, "role": "user", "parts": parts, "createdAt": at,
                    "metadata": ["version": 1, "sender": sender, "sentAt": at, "sourceSessionId": "agent-ops"]]
        }
        func text(_ s: String) -> [String: Any] { ["type": "text", "text": s] }
        func download(_ group: String) -> [String: Any] { ["type": "transfer-download", "groupId": group] }
        let line = "The new opening line lands faster, and the pause before the product name is gone."
        let messages = [
            post("p1", 1, [text("The cut with the new voice-over."), download("g-video")]),
            post("p2", 2, [text("The key frames, one sheet. " + line), download("g-sheet")]),
            post("p3", 3, [text("Both readings of the first sentence, old then new. " + line + " " + line), download("g-audio")]),
            post("p4", 4, [text(Array(repeating: line, count: 4).joined(separator: " "))]),
        ]
        var detail = try XCTUnwrap(responses["GET /agent/conversations/chat-release"] as? [String: Any])
        var body = try XCTUnwrap(detail["body"] as? [String: Any])
        body["messages"] = messages
        body["messageCount"] = messages.count
        body["timelineEvents"] = []
        detail["body"] = body
        responses["GET /agent/conversations/chat-release"] = detail
        func group(_ id: String, _ name: String, _ type: String, _ file: String) -> [String: Any] {
            ["status": 200, "body": ["groupId": id, "createdAt": "2026-11-03T09:00:00.000Z", "expiresAt": "2027-12-31T00:00:00.000Z",
                                     "files": [["id": "f-\(id)", "fileName": name, "contentType": type, "status": "ready",
                                                "downloadUrl": "file://$FIXTURE_DIR/media/\(file)"]]]]
        }
        responses["GET /agent/conversations/chat-release/attachments/g-video"] = group("g-video", "cut.mp4", "video/mp4", "clip.mp4")
        responses["GET /agent/conversations/chat-release/attachments/g-sheet"] = group("g-sheet", "sheet.jpg", "image/jpeg", "wide.png")
        responses["GET /agent/conversations/chat-release/attachments/g-audio"] = group("g-audio", "old-vs-new.m4a", "audio/mp4", "clip.mp4")
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
        addTeardownBlock { try? FileManager.default.removeItem(at: live) }

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        app.staticTexts["release-planning"].firstMatch.tap()
        return app
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
