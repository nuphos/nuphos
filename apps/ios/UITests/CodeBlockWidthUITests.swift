import XCTest

/// A code block under a short line of text takes the reply's width, not the
/// line's. Uses a copy of the offline dock fixture whose answer is a short
/// line and a code block with a long path. Run it on an iPad, where the column
/// is far wider than the line.
final class CodeBlockWidthUITests: XCTestCase {
    func testCodeBlockTakesTheReplyWidth() throws {
        let fixtures = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures")
        let live = fixtures.appending(path: "code-block-width-live.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(
            with: Data(contentsOf: fixtures.appending(path: "dock-responses.json"))) as? [String: Any])
        var chat = try XCTUnwrap(responses["GET /agent/conversations/dock-a"] as? [String: Any])
        var body = try XCTUnwrap(chat["body"] as? [String: Any])
        var messages = try XCTUnwrap(body["messages"] as? [[String: Any]])
        messages[1]["parts"] = [["type": "text", "text": "The notes are here:\n\n```text\n/home/demo/projects/sample/docs/design-notes.zh-TW.md\n```"]]
        body["messages"] = messages
        chat["body"] = body
        responses["GET /agent/conversations/dock-a"] = chat
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
        addTeardownBlock { try? FileManager.default.removeItem(at: live) }

        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-open-links", "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/dock-a"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        let transcript = app.collectionViews["chat.transcript"]
        XCTAssertTrue(transcript.cells.firstMatch.waitForExistence(timeout: 10), "The chat did not load")
        // The code block's copy button sits at its right edge.
        let copy = app.buttons["copy"]
        XCTAssertTrue(copy.waitForExistence(timeout: 5), "The code block never showed")
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "code-block"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertGreaterThan(copy.frame.maxX, transcript.frame.midX, "The code block is only as wide as the line above it")
    }
}
