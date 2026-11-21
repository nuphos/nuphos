import XCTest

/// Dragging a selection handle in a reply extends the selection, and the page
/// stays open: the full-width back swipe does not take the drag (#4419).
final class SelectionHandleDragUITests: XCTestCase {
    private let reply = "Type your email and password there."

    func testDraggingTheEndHandleRightExtendsTheSelectionAndStaysInTheChat() throws {
        continueAfterFailure = false
        let app = try launch(with: "Selectme then keep reading to the end")

        let field = app.textViews.firstMatch
        let hasField = field.waitForExistence(timeout: 30) || app.textFields.firstMatch.exists
        XCTAssertTrue(hasField, "No composer")
        let composer = field.exists ? field : app.textFields.firstMatch
        sleep(2)
        shot(app, "reply")

        // The one-line reply ends just above the composer, its first word at
        // the reply's leading edge.
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let line = composer.frame.minY - 140
        origin.withOffset(CGVector(dx: 40, dy: line)).press(forDuration: 1)
        XCTAssertTrue(app.menuItems["Copy"].firstMatch.waitForExistence(timeout: 5), "The long press selected nothing")
        shot(app, "word")

        // The end handle stands at the end of "Selectme"; drag it right along the line.
        let handle = origin.withOffset(CGVector(dx: 100, dy: line))
        handle.press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: 340, dy: line)))
        shot(app, "dragged")

        XCTAssertTrue(composer.waitForExistence(timeout: 2) && composer.isHittable, "The drag left the chat")
        let copy = app.menuItems["Copy"].firstMatch
        XCTAssertTrue(copy.waitForExistence(timeout: 5), "No selection after the drag")
        copy.tap()

        composer.tap()
        composer.press(forDuration: 1)
        let paste = app.menuItems["Paste"].firstMatch
        XCTAssertTrue(paste.waitForExistence(timeout: 5))
        paste.tap()
        let pasted = composer.value as? String ?? ""
        XCTAssertTrue(pasted.hasPrefix("Selectme then"), "The drag did not extend the selection: \(pasted)")
        shot(app, "pasted")
    }

    /// Opens the dock Task with its last reply replaced by `markdown`.
    private func launch(with markdown: String) throws -> XCUIApplication {
        let fixtures = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures")
        let live = FileManager.default.temporaryDirectory.appending(path: "selection-drag-\(UUID().uuidString).json")
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
