import XCTest

/// Pins, the Tasks layout and the Archived entry, as on Desktop (#2703): pinned
/// Bots leave the list for the shelf, Tasks group under their projects with
/// finished threads counted, and archived Tasks are a tap away.
final class PinsTasksLayoutArchiveUITests: XCTestCase {
    private typealias Fixture = BotsAndTasksListUITests
    private var live: URL!
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "pins-layout-live-\(UUID().uuidString).json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        let bots = [
            Fixture.row("bot-lead", "Release Lead", at: "09:00", avatar: "05-rembrandt"),
            Fixture.row("bot-docs", "Docs Bot", at: "09:00", avatar: "02-leonardo"),
        ]
        let history = bots + [
            Fixture.row("agent-api", "Ship the API", at: "09:40", workspace: "/Users/me/src/api"),
            // Finished threads, counted under their parent until opened.
            Fixture.row("agent-tests", "Run the API tests", at: "09:30", parent: "agent-api"),
            Fixture.row("agent-lint", "Lint the API", at: "09:20", parent: "agent-api"),
            Fixture.row("agent-web", "Fix the web build", at: "09:10", workspace: "/Users/me/src/web", unread: true),
            Fixture.row("agent-mail", "Answer the support mail", at: "09:50"),
            // What the Bots dispatched: gone with a pinned Bot, listed under one that is not.
            Fixture.row("agent-notes", "Check the release notes", at: "09:45", parent: "bot-lead", working: true),
            Fixture.row("agent-links", "Fix the docs links", at: "09:44", parent: "bot-docs", working: true),
        ]
        let chats = [
            Fixture.chat("chat-lead", "", at: "09:55", faces: [Fixture.face("bot-lead", "Release Lead", "05-rembrandt")]),
            Fixture.chat("chat-docs", "", at: "09:52", faces: [Fixture.face("bot-docs", "Docs Bot", "02-leonardo")]),
        ]
        let favorites: [String: Any] = [
            "entries": [["label": "Release Lead", "href": "/teams/\(Fixture.team)/agent/chat-lead"]], "revision": 1,
            "updatedAt": "2026-11-03T08:00:00Z",
        ]
        responses["GET /agent/conversations"] = Fixture.page(history)
        responses["GET /agent/conversations?bots=true"] = Fixture.page(bots)
        responses["GET /agent/conversations?kind=channel"] = Fixture.page(chats)
        responses["GET /agent/conversations?pendingDecision=true"] = Fixture.page([])
        responses["GET /agent/conversations?sort=archived"] = Fixture.page([
            Fixture.row("agent-old", "Migrate the old database", at: "08:00"),
        ])
        responses["GET /teams/\(Fixture.team)/favorites"] = ["status": 200, "body": favorites]
        responses["PUT /teams/\(Fixture.team)/favorites"] = ["status": 200, "body": favorites]
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testPinnedBotsLeaveTheListForTheShelf() throws {
        launch(page: "chats")
        XCTAssertTrue(app.staticTexts["Docs Bot"].firstMatch.waitForExistence(timeout: 10), "Bots did not load")
        // Folded at rest; opened by hand.
        app.buttons["Show 1 sub-agents"].firstMatch.tap()
        let docs = app.staticTexts["Fix the docs links"].firstMatch
        XCTAssertTrue(docs.waitForExistence(timeout: 3), "Opening the Bot showed nothing")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS 'Release Lead'")).firstMatch.exists, "The pin is not on the shelf")
        XCTAssertFalse(app.staticTexts["Check the release notes"].exists, "A pinned Bot's thread is still listed")
        shot("4-pins")

        app.staticTexts["Docs Bot"].firstMatch.press(forDuration: 1)
        let pin = app.buttons["Pin Bot"].firstMatch
        XCTAssertTrue(pin.waitForExistence(timeout: 5), "A Bot's row offers no pin")
        pin.tap()
        XCTAssertTrue(docs.waitForNonExistence(timeout: 5), "Pinning kept the Bot's thread in the list")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS 'Docs Bot'")).firstMatch.exists, "The new pin is not on the shelf")
        shot("5-pins-added")
    }

    func testTasksGroupUnderProjectsWithFinishedThreadsCounted() throws {
        launch(page: "agent")
        let web = app.staticTexts["Fix the web build"].firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 10), "Tasks did not load")
        for project in ["web", "api", "No project"] {
            XCTAssertTrue(app.staticTexts[project].exists, "No \(project) project row")
        }
        // The unread family leads, above the divider; the rest by their newest activity.
        let mail = app.staticTexts["Answer the support mail"].firstMatch
        let api = app.staticTexts["Ship the API"].firstMatch
        XCTAssertLessThan(web.frame.minY, mail.frame.minY)
        XCTAssertLessThan(mail.frame.minY, api.frame.minY)
        XCTAssertGreaterThan(web.frame.minX, app.staticTexts["web"].firstMatch.frame.minX, "A Task is not under its project")
        XCTAssertFalse(app.staticTexts["Run the API tests"].exists, "A finished thread is listed")
        shot("6-tasks")

        app.buttons["Show 2 done"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Run the API tests"].waitForExistence(timeout: 3), "Opening done lists nothing")
        shot("7-tasks-done-open")

        let archived = app.buttons["Archived"].firstMatch
        if !archived.exists { app.swipeUp() }
        archived.tap()
        XCTAssertTrue(app.staticTexts["Migrate the old database"].waitForExistence(timeout: 5), "Archived lists nothing")
        shot("8-archived")
    }

    private func launch(page: String) {
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", page]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
    }

    private func shot(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["NUPHOS_SHOTS"] {
            try? screenshot.pngRepresentation.write(to: URL(filePath: dir).appending(path: "\(name).png"))
        }
    }
}
