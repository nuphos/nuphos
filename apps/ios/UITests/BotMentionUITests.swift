import XCTest

/// In a Bot's 1:1 chat, `@` offers the viewer's other Bots, as a Task's composer
/// does. A picked Bot reads as its `@Title`, and a post that links one shows
/// its `@Title` rather than the URL. Offline fixture.
final class BotMentionUITests: XCTestCase {
    private var live: URL?

    override func tearDownWithError() throws {
        if let live { try? FileManager.default.removeItem(at: live) }
    }

    func testAtOffersOtherBotsByName() throws {
        let app = try launch()
        app.staticTexts["Release notes"].firstMatch.tap()
        XCTAssertTrue(app.collectionViews["chat.transcript"].cells.firstMatch.waitForExistence(timeout: 10),
                      "The Bot's chat did not load")
        // A post's text is drawn, not exposed to accessibility: the shot shows it,
        // and SessionMentionTests covers how a link reads.
        shot("bot-chat-post")

        let composer = try XCTUnwrap([app.textFields.firstMatch, app.textViews.firstMatch].first { $0.exists })
        composer.tap()
        if app.buttons["Continue"].waitForExistence(timeout: 2) { app.buttons["Continue"].tap() }
        composer.typeText("Ask @")

        let other = app.buttons["Sign-in helper"]
        let offered = other.waitForExistence(timeout: 10)
        shot("bot-chat-mention-list")
        if ProcessInfo.processInfo.environment["NUPHOS_EVIDENCE_BASELINE"] == "1" { return }
        XCTAssertTrue(offered, "`@` in a Bot's chat does not offer the other Bot")

        other.tap()
        XCTAssertEqual(composer.value as? String, "Ask @Sign-in helper ", "The picked Bot does not read as its name")
        shot("bot-chat-mention-picked")
    }

    /// Every `@` opens on what was listed before it: a read at the `@` (`limit=6`, held here for
    /// 4 s) would leave it empty, and typing on only narrows it (#3739).
    func testAtShowsBotsAtOnceFromWhatWasListed() throws {
        let app = try launch(slowSearch: true)
        app.staticTexts["Release notes"].firstMatch.tap()
        XCTAssertTrue(app.collectionViews["chat.transcript"].cells.firstMatch.waitForExistence(timeout: 10),
                      "The Bot's chat did not load")
        let composer = try XCTUnwrap([app.textFields.firstMatch, app.textViews.firstMatch].first { $0.exists })
        composer.tap()
        if app.buttons["Continue"].waitForExistence(timeout: 2) { app.buttons["Continue"].tap() }
        composer.typeText("Ask @")

        let other = app.buttons["Sign-in helper"]
        let offered = other.waitForExistence(timeout: 1.5)
        shot("mention-at-once")
        XCTAssertTrue(offered, "`@` waited on a read instead of showing the listed Bots")
        composer.typeText("Sign")
        XCTAssertTrue(other.waitForExistence(timeout: 1.5), "Typing on waited on a read")
        shot("mention-narrowed")
    }

    /// The shared fixture, with a post in "Release notes" that links the "Sign-in helper" Bot.
    private func launch(slowSearch: Bool = false) throws -> XCUIApplication {
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/bot-desktop-responses.json")
        let file = fixture.deletingLastPathComponent().appending(path: "mention-live-\(UUID().uuidString).json")
        live = file
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        let detailKey = "GET /agent/conversations/chat-bot-plain"
        var detail = try XCTUnwrap(responses[detailKey] as? [String: Any])
        var chat = try XCTUnwrap(detail["body"] as? [String: Any])
        var messages = try XCTUnwrap(chat["messages"] as? [[String: Any]])
        messages.append([
            "id": "u2", "role": "user", "createdAt": "2026-11-08T09:40:00.000Z",
            "parts": [["type": "text", "text": "Ask https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/bot-box how the login fix went"]],
            "metadata": ["version": 1, "sentAt": "2026-11-08T09:40:00.000Z",
                         "sender": ["type": "user", "id": "507f1f77bcf86cd799439011", "displayName": "Preview User", "avatarURL": ""]],
        ])
        chat["messages"] = messages
        detail["body"] = chat
        responses[detailKey] = detail
        if slowSearch, var listing = responses["GET /agent/conversations"] as? [String: Any] {
            listing["delayMs"] = 4000
            responses["GET /agent/conversations?limit=6"] = listing
        }
        try JSONSerialization.data(withJSONObject: responses).write(to: file, options: .atomic)
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": file.path]
        app.launch()
        return app
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
