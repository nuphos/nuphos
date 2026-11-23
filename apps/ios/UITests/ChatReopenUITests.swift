import XCTest

/// Opening a chat from the list, and opening it again. Uses the offline push
/// fixture, so it never contacts the backend. The transport reads the fixture
/// on every request, so a test rewrites its copy to change the next answer.
final class ChatReopenUITests: XCTestCase {
    private let detail = "GET /agent/conversations/push-a"
    private let fixture = URL(filePath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "tests/fixtures/push-responses.json")
    private lazy var live = fixture.deletingLastPathComponent().appending(path: "chat-reopen-live-\(UUID().uuidString).json")
    private var responses: [String: Any] = [:]
    private let app = XCUIApplication()
    /// A transcript's text is not in the accessibility tree, so the tests count its rows.
    private var cells: XCUIElementQuery { app.collectionViews["chat.transcript"].cells }

    override func setUpWithError() throws {
        continueAfterFailure = false
        responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        // The fixture lists the same two as chats; here they are Tasks only.
        responses["GET /agent/conversations?kind=channel"] = ["status": 200, "body": ["conversations": [Any]()]]
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testSecondChatFromListLoads() {
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()

        let transcript = app.collectionViews["chat.transcript"].cells.firstMatch
        app.staticTexts["Preview push-a"].firstMatch.tap()
        XCTAssertTrue(transcript.waitForExistence(timeout: 10), "Chat A did not load")

        if app.windows.firstMatch.horizontalSizeClass == .compact {
            app.navigationBars.buttons["BackButton"].tap()
        }
        app.staticTexts["Preview push-b"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Hello from push-b")).firstMatch.waitForExistence(timeout: 5), "The selected chat must load its own messages")
        XCTAssertTrue(transcript.waitForExistence(timeout: 10), "Chat B, opened after going back, never loaded")
    }

    /// A chat opened a moment ago shows what it had while its read is still on its way (#3525).
    func testAReopenedChatShowsItsTranscriptAtOnce() throws {
        try launch()
        open("Preview push-a")
        XCTAssertTrue(cells.firstMatch.waitForExistence(timeout: 10), "Chat A did not load")
        app.navigationBars.buttons["BackButton"].tap()

        try serve(detail, delayMs: 6000) { $0["messages"] = Array(($0["messages"] as? [Any] ?? []).prefix(1)) }
        open("Preview push-a")
        XCTAssertTrue(cells.firstMatch.waitForExistence(timeout: 2), "The reopened chat waited on its read")
        XCTAssertEqual(cells.count, 2, "The reopened chat does not show what it had")
        attach("reopened-before-read")
        wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "count == 1"), object: cells)], timeout: 15)
        attach("reopened-after-read")
    }

    /// A reread that fails leaves the transcript on screen.
    func testAFailedRereadKeepsTheTranscript() throws {
        try launch()
        open("Preview push-a")
        XCTAssertTrue(cells.firstMatch.waitForExistence(timeout: 10), "Chat A did not load")
        app.navigationBars.buttons["BackButton"].tap()

        try serve(detail, status: 500)
        open("Preview push-a")
        XCTAssertTrue(cells.firstMatch.waitForExistence(timeout: 2), "The reopened chat lost its transcript")
        XCTAssertFalse(app.staticTexts["Couldn't load this task"].waitForExistence(timeout: 4), "A failed reread covered the transcript")
        XCTAssertEqual(cells.count, 2, "A failed reread changed the transcript")
        attach("reopened-failed-reread")
    }

    /// A chat whose first read failed is read from scratch the next time.
    func testAChatThatFailedToLoadLoadsOnReopen() throws {
        try serve(detail, status: 500)
        try launch()
        open("Preview push-a")
        XCTAssertTrue(app.staticTexts["Couldn't load this task"].waitForExistence(timeout: 10), "The failed read was not shown")
        attach("failed-first-read")
        app.navigationBars.buttons["BackButton"].tap()

        try serve(detail, status: 200)
        open("Preview push-a")
        XCTAssertTrue(cells.firstMatch.waitForExistence(timeout: 10), "The chat kept its failed read")
        attach("reopened-after-failed-read")
    }

    /// A chat left while its own turn is streaming comes back with what was sent.
    /// The fixture's conversation does not have that message, so a fresh read would drop it.
    func testAChatLeftMidTurnKeepsWhatWasSent() throws {
        responses["POST /agent/chat"] = ["status": 200, "body": [:], "delayMs": 30000,
                                         "headers": ["Content-Type": "text/event-stream"]]
        try launch()
        open("Preview push-a")
        XCTAssertTrue(cells.firstMatch.waitForExistence(timeout: 10), "Chat A did not load")

        let composer = app.textViews.firstMatch
        composer.tap()
        if app.buttons["Continue"].waitForExistence(timeout: 2) { app.buttons["Continue"].tap() }
        composer.typeText("Still there?")
        app.buttons["Send"].firstMatch.tap()
        let sent = NSPredicate(format: "count > 2")
        wait(for: [XCTNSPredicateExpectation(predicate: sent, object: cells)], timeout: 5)
        attach("mid-turn")

        app.navigationBars.buttons["BackButton"].tap()
        open("Preview push-a")
        XCTAssertTrue(cells.firstMatch.waitForExistence(timeout: 3), "The reopened chat waited on its read")
        for _ in 0..<4 {
            XCTAssertGreaterThan(cells.count, 2, "The reopened chat lost the turn it was streaming")
            sleep(1)
        }
        attach("reopened-mid-turn")
    }

    private func launch() throws {
        try serve()
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let tasks = app.tabBars.buttons["Tasks"].firstMatch
        XCTAssertTrue(tasks.waitForExistence(timeout: 15))
        tasks.tap()
    }

    private func open(_ title: String) {
        let row = app.staticTexts[title].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "\(title) is not in the list")
        row.tap()
    }

    /// Writes the fixture, changing how one request is answered from here on.
    private func serve(_ key: String? = nil, status: Int? = nil, delayMs: Int? = nil,
                       body change: ((inout [String: Any]) -> Void)? = nil) throws {
        if let key, var entry = responses[key] as? [String: Any] {
            if let status { entry["status"] = status }
            entry["delayMs"] = delayMs
            if let change, var body = entry["body"] as? [String: Any] {
                change(&body)
                entry["body"] = body
            }
            responses[key] = entry
        }
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
