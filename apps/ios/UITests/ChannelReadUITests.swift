import XCTest

/// A post that arrives while a chat is open is read: going back shows the chat
/// as read. The chat is the second one opened, after going back from another,
/// where SwiftUI ends the chat view's appearance while it stays on screen.
/// Uses a copy of the offline chats fixture, rewritten while the chat is open.
final class ChannelReadUITests: XCTestCase {
    func testPostWhileOpenIsRead() throws {
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        let live = fixture.deletingLastPathComponent().appending(path: "channel-read-live.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        // The read marker the app sends for design-review lands here.
        responses["POST /agent/conversations/chat-design/read"] = ["status": 200, "body": ["activitySeq": 4, "readSeq": 4]]
        try write(responses, to: live)
        defer { try? FileManager.default.removeItem(at: live) }

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()

        let transcript = app.collectionViews["chat.transcript"].cells.firstMatch
        app.staticTexts["release-planning"].firstMatch.tap()
        XCTAssertTrue(transcript.waitForExistence(timeout: 10), "Chat A did not load")
        app.navigationBars.buttons["BackButton"].tap()
        app.staticTexts["design-review"].firstMatch.tap()
        let empty = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Everyone here sees'")).firstMatch
        XCTAssertTrue(empty.waitForExistence(timeout: 10), "Chat B did not load")

        // An agent posts while the chat is open: the server's activity moves past
        // the viewer's read marker, in the chat and in the list.
        let reply = "Mockups are in the review folder."
        var detail = try XCTUnwrap(responses["GET /agent/conversations/chat-design"] as? [String: Any])
        var body = try XCTUnwrap(detail["body"] as? [String: Any])
        body["messages"] = [[
            "id": "d1", "role": "user", "parts": [["type": "text", "text": reply]],
            "metadata": ["version": 1, "sender": ["type": "agent", "id": "agent-ops", "displayName": "Release ops"],
                         "sentAt": "2026-11-03T09:45:00.000Z", "sourceSessionId": "agent-ops"],
            "createdAt": "2026-11-03T09:45:00.000Z",
        ]]
        body["messageCount"] = 1
        body["transcriptUpdatedAt"] = "2026-11-03T09:45:00.000Z"
        body["activitySeq"] = 4
        body["readSeq"] = 3
        detail["body"] = body
        responses["GET /agent/conversations/chat-design"] = detail
        var listing = try XCTUnwrap(responses["GET /agent/conversations?kind=channel"] as? [String: Any])
        var listed = try XCTUnwrap(listing["body"] as? [String: Any])
        listed["conversations"] = try XCTUnwrap(listed["conversations"] as? [[String: Any]]).map { row in
            guard row["sessionId"] as? String == "chat-design" else { return row }
            return row.merging(["activitySeq": 4, "readSeq": 3, "lastActiveAt": "2026-11-03T09:45:00Z"]) { $1 }
        }
        listing["body"] = listed
        responses["GET /agent/conversations?kind=channel"] = listing
        try write(responses, to: live)

        // Chat B had no posts, so a cell is the new one.
        XCTAssertTrue(transcript.waitForExistence(timeout: 15), "The new post never showed")
        app.navigationBars.buttons["BackButton"].tap()
        XCTAssertTrue(app.staticTexts["design-review"].waitForExistence(timeout: 10))
        // The listing still reports the old marker; only the read the app sent clears the dot.
        let unread = app.descendants(matching: .any)["Unread posts"]
        XCTAssertFalse(unread.waitForExistence(timeout: 5), "The chat read while open shows as unread")
    }

    private func write(_ responses: [String: Any], to url: URL) throws {
        try JSONSerialization.data(withJSONObject: responses).write(to: url, options: .atomic)
    }
}
