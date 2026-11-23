import XCTest

/// A reply that cites files the agent sent (`![…](https://nuphos.ai/_reply-images/<groupId>)`)
/// shows them where it cites them, read with the viewer's access: an image, a video and a
/// file. A group listed with the chat's downloads too is not drawn a second time below it,
/// and a group that can no longer be read says so.
final class ReplyFilesUITests: XCTestCase {
    private static let team = "64b5f1c2e4b0a1d2c3e4f5a6"
    private static let sent = "0123456789abcdef01234567"
    private static let gone = "fedcba9876543210fedcba98"

    func testCitedFilesShowInTheReplyOnce() throws {
        let app = try launch()

        let image = app.buttons["Open wide.png"]
        XCTAssertTrue(image.waitForExistence(timeout: 30), "The cited image never showed")
        XCTAssertTrue(app.buttons["Open clip.mp4"].exists, "The cited video did not show")
        XCTAssertTrue(app.buttons["Open notes.pdf"].exists, "The cited file did not show")
        XCTAssertTrue(app.staticTexts["File expired — no longer available."].waitForExistence(timeout: 10),
                      "A cited group that can't be read said nothing")
        let images = app.buttons.matching(NSPredicate(format: "label == %@", "Open wide.png"))
        XCTAssertEqual(images.count, 1, "The cited group showed again as a download card")
        XCTAssertFalse(app.buttons["https://nuphos.ai/_reply-images/\(Self.sent)"].exists, "The reference showed as a link")
        shot("reply-files")

        image.tap()
        let counter = app.staticTexts["2 / 2"]
        XCTAssertTrue(counter.waitForExistence(timeout: 10), "The image did not open in the pager")
        shot("reply-image-open")
    }

    /// Opens the dock-a Task, whose reply cites both groups.
    private func launch() throws -> XCUIApplication {
        let fixtures = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures")
        let live = fixtures.appending(path: "reply-files-live.json")
        let reply = "Type your email and password there."
        let cite = { (alt: String, id: String) in "\\n\\n![\(alt)](https://nuphos.ai/_reply-images/\(id))" }
        let text = try String(contentsOf: fixtures.appending(path: "dock-responses.json"), encoding: .utf8)
            .replacingOccurrences(of: "\(reply)\"", with: "\(reply)\(cite("shot", Self.sent))\(cite("old", Self.gone))\"")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        let file = { (name: String, type: String, link: String) -> [String: Any] in
            ["id": "f-\(name)", "fileName": name, "contentType": type, "status": "ready", "downloadUrl": link]
        }
        let group: [String: Any] = [
            "groupId": Self.sent, "createdAt": "2026-11-03T09:00:00.000Z", "expiresAt": "2027-12-31T00:00:00.000Z",
            "files": [file("clip.mp4", "video/mp4", "file://$FIXTURE_DIR/media/clip.mp4"),
                      file("wide.png", "image/png", "file://$FIXTURE_DIR/media/wide.png"),
                      file("notes.pdf", "application/pdf", "file://$FIXTURE_DIR/media/wide.png")],
        ]
        responses["GET /teams/\(Self.team)/file-transfers/\(Self.sent)/download"] = ["status": 200, "body": group]
        responses["GET /teams/\(Self.team)/file-transfers/\(Self.gone)/download"] = ["status": 404, "body": ["error": "Not found"]]
        responses["GET /agent-sessions/dock-a/teams/\(Self.team)/file-transfers/downloads"] = ["status": 200, "body": ["groups": [group]]]
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
        addTeardownBlock { try? FileManager.default.removeItem(at: live) }

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-open-links",
                               "https://nuphos.ai/teams/\(Self.team)/agent/dock-a"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"].firstMatch
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        return app
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
