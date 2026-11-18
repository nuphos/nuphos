import XCTest

/// Synthetic offline chat posts; no provider or customer account is used.
/// A reply quotes its post inside its own bubble, the composer's reply chip
/// shows the quote on its own lines, and an answer given in the Inbox is the
/// answerer's own bubble quoting the question.
final class ChannelReplyStyleUITests: XCTestCase {
    /// The preview account's own id, so a post from it is drawn as the viewer's.
    private let me: [String: Any] = ["type": "user", "id": "507f1f77bcf86cd799439011", "displayName": "Bruce Wayne"]
    private let diana: [String: Any] = ["type": "user", "id": "5f1b2c3d4e5f60718293a4b5", "displayName": "Diana Prince"]
    private let bot: [String: Any] = ["type": "agent", "id": "agent-ops", "displayName": "Preview Bot"]
    private let question = "Should the release go to staging before the weekly sync on Thursday afternoon?"

    func testAReplyQuotesItsPostInsideItsBubble() throws {
        let app = try launch([
            post("original", question, bot, at: "09:20"),
            post("reply", "On it.", me, at: "09:21", extra: ["replyTo": ["id": "original", "authorName": "Preview Bot", "text": question]]),
        ])
        let quote = app.buttons["Replying to Preview Bot: \(question)"]
        XCTAssertTrue(quote.waitForExistence(timeout: 15), app.debugDescription)
        let bubble = app.otherElements.matching(identifier: "channel.bubble")
            .containing(.button, identifier: "channel.quote").firstMatch
        XCTAssertTrue(bubble.exists, "The quote is not inside a bubble: \(app.debugDescription)")
        XCTAssertTrue(bubble.frame.insetBy(dx: -1, dy: -1).contains(quote.frame), "quote \(quote.frame) outside bubble \(bubble.frame)")
        // The reply's own words, under the quote.
        let words = try XCTUnwrap(bubble.descendants(matching: .other).allElementsBoundByIndex.last)
        XCTAssertGreaterThanOrEqual(words.frame.minY, quote.frame.maxY, "The quote is not above the reply's words")
        XCTAssertLessThanOrEqual(quote.frame.width, 241)
        keep(app, "reply-inside")
    }

    func testTheReplyChipShowsWhoAndTheQuoteOnTheirOwnLines() throws {
        let app = try launch([post("original", question, bot, at: "09:20")])
        // Cells: the timestamp, then the Bot's post.
        let cell = app.collectionViews["chat.transcript"].cells.element(boundBy: 1)
        XCTAssertTrue(cell.waitForExistence(timeout: 15), app.debugDescription)
        cell.press(forDuration: 1)
        XCTAssertTrue(app.buttons["Reply"].waitForExistence(timeout: 5))
        app.buttons["Reply"].tap()
        let who = app.staticTexts["Replying to Preview Bot"]
        XCTAssertTrue(who.waitForExistence(timeout: 5), app.debugDescription)
        let quoted = app.staticTexts.matching(identifier: "channel.replyChip.text").firstMatch
        XCTAssertTrue(quoted.exists)
        XCTAssertEqual(quoted.label, question)
        XCTAssertGreaterThanOrEqual(quoted.frame.minY, who.frame.maxY - 1, "The quote is not under who it replies to")
        XCTAssertTrue(app.buttons["Cancel reply"].exists)
        keep(app, "reply-chip")
        app.buttons["Cancel reply"].tap()
        XCTAssertFalse(who.waitForExistence(timeout: 1))
    }

    func testInboxAnswersAreTheAnswerersBubbles() throws {
        let inbox = { (request: String, question: String) -> [String: Any] in
            // As #3548 specifies: written by the server, from the person who answered.
            ["source": "nuphos", "replyTo": ["authorName": "Preview Bot", "text": question], "answeredIn": "inbox", "requestId": request]
        }
        let app = try launch([
            // An answer recorded before answers were posts keeps its line.
            ["id": "record", "role": "user", "parts": [["type": "text", "text": "Diana Prince answered: Rotate the key? → Yes"]],
             "metadata": ["version": 1, "sender": ["type": "system", "id": "nuphos:decision", "displayName": "Nuphos"],
                          "sentAt": "2026-11-03T09:00:00.000Z"],
             "createdAt": "2026-11-03T09:00:00.000Z"],
            post("a1", "Friday", diana, at: "09:20", extra: inbox("req-1", "Which day works for the move?")),
            post("a2", "Staging first", diana, at: "09:20", extra: inbox("req-1", "Where should it go first?")),
            post("b1", "Ship it", me, at: "09:21", extra: inbox("req-2", question)),
        ])
        let mine = app.buttons["Replying to Preview Bot: \(question)"]
        XCTAssertTrue(mine.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(app.staticTexts["Diana Prince answered: Rotate the key? → Yes"].exists, "The old record lost its line")
        XCTAssertTrue(app.buttons["Replying to Preview Bot: Which day works for the move?"].exists)
        let dianasLast = app.buttons["Replying to Preview Bot: Where should it go first?"]
        XCTAssertTrue(dianasLast.exists)
        // One line per card, under its last answer, on that answer's side.
        let lines = app.descendants(matching: .any).matching(identifier: "channel.answeredInInbox")
        XCTAssertEqual(lines.count, 2)
        let width = app.windows.firstMatch.frame.width
        let theirs = lines.element(boundBy: 0), ours = lines.element(boundBy: 1)
        XCTAssertLessThan(theirs.frame.midX, width / 2)
        XCTAssertGreaterThan(theirs.frame.minY, dianasLast.frame.maxY)
        XCTAssertGreaterThan(ours.frame.midX, width / 2)
        XCTAssertGreaterThan(ours.frame.minY, mine.frame.maxY)
        XCTAssertGreaterThan(mine.frame.midX, width / 2, "The viewer's answer is not on the right")
        XCTAssertTrue(app.staticTexts["Diana Prince"].exists, "The answerer's name is missing")
        keep(app, "inbox-answers")
    }

    private func post(_ id: String, _ text: String, _ sender: [String: Any], at time: String,
                      extra: [String: Any] = [:]) -> [String: Any] {
        let sentAt = "2026-11-03T\(time):00.000Z"
        var metadata: [String: Any] = ["version": 1, "sender": sender, "sentAt": sentAt]
        if sender["type"] as? String == "agent" { metadata["sourceSessionId"] = sender["id"] }
        metadata.merge(extra) { $1 }
        return ["id": id, "role": "user", "parts": [["type": "text", "text": text]], "metadata": metadata, "createdAt": sentAt]
    }

    private func launch(_ messages: [[String: Any]]) throws -> XCUIApplication {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        var detail = try XCTUnwrap(responses["GET /agent/conversations/chat-release"] as? [String: Any])
        var body = try XCTUnwrap(detail["body"] as? [String: Any])
        body["messages"] = messages
        body["messageCount"] = messages.count
        body["timelineEvents"] = []
        detail["body"] = body
        responses["GET /agent/conversations/chat-release"] = detail
        let live = FileManager.default.temporaryDirectory.appending(path: "reply-style-\(UUID().uuidString).json")
        addTeardownBlock { try? FileManager.default.removeItem(at: live) }
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent", "-open-links",
            "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/chat-release"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        return app
    }

    private func keep(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
