import XCTest

/// A Bot post's files still show when the first read of their group fails
/// and a later refresh reads it. Uses a copy of the offline chats fixture,
/// rewritten mid-test: the preview transport reads it on every request.
final class ChatAttachmentRetryUITests: XCTestCase {
    func testFilesShowAfterAFailedFirstRead() throws {
        let (app, write) = try launch()
        XCTAssertTrue(app.staticTexts["Release ops"].waitForExistence(timeout: 10), "The transcript never loaded")
        sleep(2)
        XCTAssertFalse(app.buttons["Open sheet.jpg"].exists, "The first read should have failed")
        try write(true)
        // The later post's own file shows once the chat has refreshed.
        XCTAssertTrue(app.buttons["Open notes.txt"].waitForExistence(timeout: 30), "The chat never refreshed")
        XCTAssertTrue(app.buttons["Open sheet.jpg"].waitForExistence(timeout: 10),
                      "The files never show after the group became readable")
    }

    private func launch() throws -> (XCUIApplication, (Bool) throws -> Void) {
        let fixtures = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures")
        let live = fixtures.appending(path: "chat-attachment-retry-live.json")
        let base = try XCTUnwrap(JSONSerialization.jsonObject(
            with: Data(contentsOf: fixtures.appending(path: "channel-responses.json"))) as? [String: Any])
        let sender: [String: Any] = ["type": "agent", "id": "agent-ops", "displayName": "Release ops", "agentRuntime": "codex"]
        func post(_ id: String, _ minute: Int, _ parts: [[String: Any]]) -> [String: Any] {
            let at = String(format: "2026-11-03T09:%02d:00.000Z", minute)
            return ["id": id, "role": "user", "parts": parts, "createdAt": at,
                    "metadata": ["version": 1, "sender": sender, "sentAt": at, "sourceSessionId": "agent-ops"]]
        }
        let first = post("p1", 1, [["type": "text", "text": "The key frames, one sheet."],
                                   ["type": "transfer-download", "groupId": "g-sheet"]])
        let later = post("p2", 2, [["type": "text", "text": "Both readings are attached."],
                                   ["type": "transfer-download", "groupId": "g-notes"]])
        func group(_ id: String, _ name: String, _ type: String, _ media: String) -> [String: Any] {
            ["status": 200, "body": ["groupId": id, "createdAt": "2026-11-03T09:00:00.000Z", "expiresAt": "2027-12-31T00:00:00.000Z",
                                     "files": [["id": "f-\(id)", "fileName": name, "contentType": type, "status": "ready",
                                                "downloadUrl": "file://$FIXTURE_DIR/media/\(media)"]]]]
        }
        let write = { (readable: Bool) throws in
            var responses = base
            var detail = try XCTUnwrap(responses["GET /agent/conversations/chat-release"] as? [String: Any])
            var body = try XCTUnwrap(detail["body"] as? [String: Any])
            let messages = readable ? [first, later] : [first]
            body["messages"] = messages
            body["messageCount"] = messages.count
            body["timelineEvents"] = []
            body["transcriptUpdatedAt"] = readable ? "2026-11-03T09:50:00.000Z" : "2026-11-03T09:40:00.000Z"
            detail["body"] = body
            responses["GET /agent/conversations/chat-release"] = detail
            responses["GET /agent/conversations/chat-release/attachments/g-sheet"] = readable
                ? group("g-sheet", "sheet.jpg", "image/jpeg", "wide.png") : ["status": 503, "body": ["error": "busy"]]
            responses["GET /agent/conversations/chat-release/attachments/g-notes"] = group("g-notes", "notes.txt", "text/plain", "wide.png")
            try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
        }
        try write(false)
        addTeardownBlock { try? FileManager.default.removeItem(at: live) }

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        app.staticTexts["release-planning"].firstMatch.tap()
        return (app, write)
    }
}
