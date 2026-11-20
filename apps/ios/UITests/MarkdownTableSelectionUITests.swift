import XCTest

/// A long press on a word in a reply's Markdown table selects that word, not
/// one in the paragraph below the table (#3318). The table is wider than the
/// screen, so it scrolls on its own.
final class MarkdownTableSelectionUITests: XCTestCase {
    private let reply = "Type your email and password there."

    func testLongPressInATableCellSelectsTheCellWord() throws {
        continueAfterFailure = false
        let rows = (1...6).map { "| Cellword | eu-west-\($0) | ops | A note long enough to push this table past the screen edge |" }
        let table = (["| Name | Region | Owner | Notes |", "|---|---|---|---|"] + rows).joined(separator: "\\n")
        let app = try launch(with: "\(table)\\n\\nParagraph below the table.")

        let window = app.windows.firstMatch.frame
        // The composer is a text view (a vertical text field on iOS 27) or a text field.
        let field = app.textViews.firstMatch
        let hasField = field.waitForExistence(timeout: 30) || app.textFields.firstMatch.exists
        shot(app, "opened")
        XCTAssertTrue(hasField, "No composer")
        let composer = field.exists ? field : app.textFields.firstMatch
        sleep(2)
        shot(app, "reply")
        // The reply ends just above the composer: the paragraph is its last line,
        // about 140 pt up, and the table's rows fill the space above it. This
        // lands on a "Cellword" a few rows up from the table's bottom.
        let point = CGPoint(x: 55, y: composer.frame.minY - 260)
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: point.x, dy: point.y))
            .press(forDuration: 1)
        let copy = app.menuItems["Copy"].firstMatch
        XCTAssertTrue(copy.waitForExistence(timeout: 5), "The long press selected nothing")
        shot(app, "selection")
        copy.tap()

        composer.tap()
        composer.press(forDuration: 1)
        let paste = app.menuItems["Paste"].firstMatch
        XCTAssertTrue(paste.waitForExistence(timeout: 5))
        paste.tap()
        XCTAssertEqual(composer.value as? String, "Cellword", "The press at \(point) in \(window) copied the wrong word")
        shot(app, "pasted")
    }

    /// Opens the dock Task with its last reply replaced by `markdown`.
    private func launch(with markdown: String) throws -> XCUIApplication {
        let fixtures = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures")
        let live = FileManager.default.temporaryDirectory.appending(path: "markdown-table-\(UUID().uuidString).json")
        let text = try String(contentsOf: fixtures.appending(path: "dock-responses.json"), encoding: .utf8)
        let replaced = text.replacingOccurrences(
            of: "I opened the sign-up page in the Nuphos browser on your Mac. \(reply)\"", with: "\(markdown)\"")
        XCTAssertNotEqual(replaced, text, "The fixture's reply moved")
        try replaced.write(to: live, atomically: true, encoding: .utf8)
        addTeardownBlock { try? FileManager.default.removeItem(at: live) }

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-open-links",
                               "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/dock-a"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        return app
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
