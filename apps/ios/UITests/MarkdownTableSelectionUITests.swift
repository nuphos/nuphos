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
        // The table's first column holds the header and then a "Cellword" per
        // row. A label is only as tall as its text, while the wrapped notes make
        // each row taller, so press the fifth row's label itself.
        let cell = app.collectionViews["chat.transcript"].scrollViews.firstMatch
            .children(matching: .other).element(boundBy: 0)
            .children(matching: .other).element(boundBy: 5)
        XCTAssertTrue(cell.waitForExistence(timeout: 5), "No table cell")
        cell.press(forDuration: 1)
        let copy = app.menuItems["Copy"].firstMatch
        XCTAssertTrue(copy.waitForExistence(timeout: 5), "The long press selected nothing")
        shot(app, "selection")
        copy.tap()

        composer.tap()
        composer.press(forDuration: 1)
        let paste = app.menuItems["Paste"].firstMatch
        XCTAssertTrue(paste.waitForExistence(timeout: 5))
        paste.tap()
        XCTAssertEqual(composer.value as? String, "Cellword", "The press on \(cell.frame) in \(window) copied the wrong word")
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
