import XCTest

/// A folded turn's "Worked for … · … steps" label stays on one line and the rule
/// beside it takes only the width left over, as on the desktop. Uses a copy of the
/// offline dock fixture whose answer follows 22 tool calls over 2m 37s, at a larger
/// text size so a wrapped label grows the row past its 44pt minimum.
final class WorkFoldLabelUITests: XCTestCase {
    func testWorkLabelStaysOnOneLine() throws {
        let fixtures = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures")
        let live = fixtures.appending(path: "work-fold-label-live.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(
            with: Data(contentsOf: fixtures.appending(path: "dock-responses.json"))) as? [String: Any])
        var chat = try XCTUnwrap(responses["GET /agent/conversations/dock-a"] as? [String: Any])
        var body = try XCTUnwrap(chat["body"] as? [String: Any])
        var messages = try XCTUnwrap(body["messages"] as? [[String: Any]])
        let start = 1_700_000_000_000.0
        let calls = (0..<22).map { i -> [String: Any] in
            let startedAt = start + Double(i) * 7_000
            let completedAt = i == 21 ? start + 157_000 : startedAt + 5_000
            return ["type": "dynamic-tool", "toolName": "bash", "toolCallId": "call-\(i)", "state": "output-available",
                    "input": ["command": "ls docs/page-\(i)"], "output": "page-\(i).md",
                    "startedAt": startedAt, "completedAt": completedAt]
        }
        messages[1]["parts"] = calls + [["type": "text", "text": "The docs site has 22 pages."]]
        body["messages"] = messages
        chat["body"] = body
        responses["GET /agent/conversations/dock-a"] = chat
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
        addTeardownBlock { try? FileManager.default.removeItem(at: live) }

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-open-links", "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/dock-a",
                               "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryXXXL"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"].firstMatch
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        let fold = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Worked for 2m 37s'")).firstMatch
        XCTAssertTrue(fold.waitForExistence(timeout: 10), "The folded turn never showed")
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "work-fold"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertLessThanOrEqual(fold.frame.height, 44.5, "The label wrapped to give the rule beside it half the row")
    }
}
