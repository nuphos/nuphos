import XCTest

/// Every usage bar says when its window resets (#3732): the Runtimes row names the
/// tightest window's reset, and the agent's page names each window's. Offline fixture,
/// with reset times written relative to now and checked loosely enough for a slow run.
/// A cloud runtime, since only those open the agent's page from Computers & runtimes.
final class UsageResetsUITests: XCTestCase {
    func testUsageBarsSayWhenTheyReset() throws {
        let fixtures = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures")
        var responses = try JSONSerialization.jsonObject(
            with: Data(contentsOf: fixtures.appending(path: "runtimes-desktop-responses.json"))) as! [String: Any]
        let iso = ISO8601DateFormatter()
        func from(now seconds: TimeInterval) -> String { iso.string(from: Date().addingTimeInterval(seconds)) }
        let runtimes = "GET /teams/64b5f1c2e4b0a1d2c3e4f5a6/agent-runtimes"
        var listed = responses[runtimes] as! [String: Any], body = listed["body"] as! [String: Any]
        body["runtimes"] = (body["runtimes"] as! [Any]) + [[
            "id": "11111111-1111-4111-8111-111111111111", "provider": "claude-code",
            "label": "Cloud Claude Code", "status": "active", "kind": "managed",
        ]]
        listed["body"] = body
        responses[runtimes] = listed
        responses["\(runtimes)/quota"] = ["status": 200, "body": ["quotas": [[
            "runtimeId": "11111111-1111-4111-8111-111111111111",
            "provider": "claude-code",
            "fetchedAt": from(now: 0),
            "available": true,
            "windows": [
                ["id": "five_hour", "label": "5-hour", "usedPercent": 38, "resetsAt": from(now: (3 * 60 + 30) * 60)],
                ["id": "seven_day", "label": "Weekly", "usedPercent": 12, "resetsAt": from(now: (2 * 24 + 5) * 3600 + 1800)],
            ],
        ]]]]
        let fixture = FileManager.default.temporaryDirectory.appending(path: "usage-resets-responses.json")
        try JSONSerialization.data(withJSONObject: responses).write(to: fixture)

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()
        // Computers & runtimes is on the home toolbar since #3343.
        let computers = app.buttons["Computers & runtimes"].firstMatch
        XCTAssertTrue(computers.waitForExistence(timeout: 10), "No Computers & runtimes on the toolbar")
        computers.tap()

        // The 5-hour window is the tightest, so the row names its reset, in hours.
        let row = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "62% left · resets in 3h ")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "The Runtimes row does not say when its usage resets")
        attach(app, "usage-resets-runtimes")

        row.tap()
        for prefix in ["resets in 3h ", "resets in 2d 5h"] {
            let text = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
            XCTAssertTrue(text.waitForExistence(timeout: 10), "The agent's page does not say \(prefix)")
        }
        attach(app, "usage-resets-agent")
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
