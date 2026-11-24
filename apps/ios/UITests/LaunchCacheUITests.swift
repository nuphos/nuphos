import XCTest

/// A relaunch opens on what the last launch showed, as a messaging app does: the list
/// and a chat paint from the device while every read is still on its way.
/// Uses the offline fixtures, so it never contacts the backend.
final class LaunchCacheUITests: XCTestCase {
    private let fixtures = URL(filePath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "tests/fixtures")
    private lazy var live = fixtures.appending(path: "launch-cache-live-\(UUID().uuidString).json")
    /// The cache this test's launches share, and no other run reads.
    private let run = UUID().uuidString
    private let app = XCUIApplication()
    private var cells: XCUIElementQuery { app.collectionViews["chat.transcript"].cells }

    override func setUp() {
        continueAfterFailure = false
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testAChatOpensWithoutLoadingAfterARelaunch() throws {
        try relaunch(fixture: "channel-responses.json", slow: false)
        open("release-planning")
        XCTAssertTrue(cells.firstMatch.waitForExistence(timeout: 10), "The chat did not load")
        app.terminate()

        try relaunch(fixture: "channel-responses.json", slow: true)
        assertNoLoading("the relaunched list")
        open("release-planning", timeout: 3)
        XCTAssertTrue(cells.firstMatch.waitForExistence(timeout: 3), "The chat waited on its read")
        XCTAssertFalse(app.activityIndicators.firstMatch.exists, "The chat showed a spinner")
        attach("chat-from-cache")
    }

    func testATaskOpensWithoutLoadingAfterARelaunch() throws {
        try relaunch(fixture: "push-responses.json", slow: false, tasksOnly: true)
        open("Preview push-a")
        XCTAssertTrue(cells.firstMatch.waitForExistence(timeout: 10), "The task did not load")
        app.terminate()

        try relaunch(fixture: "push-responses.json", slow: true, tasksOnly: true)
        assertNoLoading("the relaunched list")
        open("Preview push-a", timeout: 3)
        XCTAssertTrue(cells.firstMatch.waitForExistence(timeout: 3), "The task waited on its read")
        XCTAssertFalse(app.activityIndicators.firstMatch.exists, "The task showed a spinner")
        attach("task-from-cache")
    }

    /// `slow` holds every read for longer than the test runs, so only the cache can paint.
    private func relaunch(fixture name: String, slow: Bool, tasksOnly: Bool = false) throws {
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(
            with: Data(contentsOf: fixtures.appending(path: name))) as? [String: Any])
        if tasksOnly {
            // The push fixture lists its two as chats too; here they are Tasks only.
            responses["GET /agent/conversations?kind=channel"] = ["status": 200, "body": ["conversations": [Any]()]]
        }
        if slow {
            for (key, value) in responses where key.hasPrefix("GET ") {
                guard var entry = value as? [String: Any] else { continue }
                entry["delayMs"] = 30000
                responses[key] = entry
            }
        }
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path, "NUPHOS_PREVIEW_LAUNCH_CACHE": run]
        app.launch()
        if tasksOnly {
            let tasks = app.tabBars.buttons["Tasks"].firstMatch
            XCTAssertTrue(tasks.waitForExistence(timeout: 15))
            tasks.tap()
        }
    }

    private func assertNoLoading(_ what: String) {
        for label in ["Loading tasks…", "Loading chats…"] {
            XCTAssertFalse(app.staticTexts[label].exists, "\(what) showed \(label)")
        }
        XCTAssertTrue(app.buttons["Switch team"].exists, "\(what) had no team yet")
    }

    private func open(_ title: String, timeout: TimeInterval = 15) {
        let row = app.staticTexts[title].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: timeout), "\(title) is not in the list")
        assertNoLoading("the list")
        row.tap()
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
