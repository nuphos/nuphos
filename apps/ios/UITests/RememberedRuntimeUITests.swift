import CryptoKit
import XCTest

/// #3667: the runtime remembered for a workspace went away while another one is ready.
final class RememberedRuntimeUITests: XCTestCase {
    private let team = "64b5f1c2e4b0a1d2c3e4f5a6"
    private let gone = "22222222-2222-4222-8222-222222222222"
    private let ready = "11111111-1111-4111-8111-111111111111"

    func testAnUnavailableRememberedRuntimeStillLetsATaskStart() throws {
        let app = try launch()

        let create = app.buttons["Create"]
        XCTAssertTrue(create.waitForExistence(timeout: 15))
        let enabled = NSPredicate(format: "isEnabled == true")
        expectation(for: enabled, evaluatedWith: create)
        waitForExpectations(timeout: 10)
        create.tap()
        app.buttons["New Task"].tap()
        XCTAssertTrue(app.navigationBars["New Task"].waitForExistence(timeout: 5))

        let choose = app.buttons["Choose runtime: Choose runtime"]
        XCTAssertTrue(choose.waitForExistence(timeout: 5), "New Task does not ask for a runtime")
        let composer = app.textViews.firstMatch
        composer.tap()
        composer.typeText("Plan the release")
        XCTAssertFalse(app.buttons["Send"].firstMatch.isEnabled, "Send works before a runtime is picked")
    }

    /// #3947: New Bot was greyed out here, with no reason. Now Create asks for a runtime, then makes the Bot.
    func testAnUnavailableRememberedRuntimeStillLetsABotBeMade() throws {
        let app = try launch(["POST /agent/bots": ["status": 200, "body": ["sessionId": "bot-atlas"]]])

        let create = app.buttons["Create"]
        XCTAssertTrue(create.waitForExistence(timeout: 15))
        XCTAssertTrue(create.wait(for: \.isEnabled, toEqual: true, timeout: 10))
        create.tap()
        let newBot = app.buttons["New Bot"]
        XCTAssertTrue(newBot.waitForExistence(timeout: 5))
        XCTAssertTrue(newBot.isEnabled, "New Bot is greyed out")
        newBot.tap()
        let name = app.textFields["Name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.typeText("Atlas")
        app.navigationBars["New Bot"].buttons["Create"].tap()

        XCTAssertTrue(app.navigationBars["Choose runtime"].waitForExistence(timeout: 5), "Create did not ask for a runtime")
        app.descendants(matching: .any)["agent-\(ready)"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["New Bot"].waitForNonExistence(timeout: 10), "The Bot was not made after picking a runtime")
    }

    private func launch(_ extra: [String: Any] = [:]) throws -> XCUIApplication {
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        responses["GET /agent/conversations"] = ["status": 200, "body": ["conversations": [], "hasMore": false, "nextCursor": NSNull()]]
        responses["GET /teams/\(team)/agent-runtimes"] = ["status": 200, "body": ["runtimes": [
            ["id": gone, "provider": "codex", "label": "Old Codex", "status": "disabled", "kind": "managed"],
            ["id": ready, "provider": "codex", "label": "Preview Codex", "status": "active", "kind": "managed"],
        ]]]
        responses.merge(extra) { $1 }
        let live = URL.temporaryDirectory.appending(path: "remembered-\(UUID()).json")
        try JSONSerialization.data(withJSONObject: responses).write(to: live)

        // The app remembers a runtime per account and workspace; preview runs as "preview-only".
        let account = SHA256.hash(data: Data("preview-only".utf8)).map { String(format: "%02x", $0) }.joined()
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent",
                               "-nuphos.agent.runtimeInstance.\(account).\(team)", gone]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        return app
    }
}
