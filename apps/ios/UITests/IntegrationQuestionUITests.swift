import XCTest

/// Offline integration request in an ordinary conversation, using only synthetic accounts.
final class IntegrationQuestionUITests: XCTestCase {
    func testQuestionOpensTheExistingCredentialPicker() throws {
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/push-responses.json")
        let live = FileManager.default.temporaryDirectory.appending(path: "integration-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: live) }
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        var conversation = try XCTUnwrap(responses["GET /agent/conversations/push-a"] as? [String: Any])
        var body = try XCTUnwrap(conversation["body"] as? [String: Any])
        body["credentialAccess"] = ["trelloIntegrationIds": []]
        body["messages"] = [["id": "integration", "role": "assistant", "parts": [[
            "type": "dynamic-tool", "toolCallId": "ask-trello", "toolName": "Request a Trello connection",
            "state": "output-available", "input": ["category": "integration", "providers": ["trello"],
                "question": "Connect Trello for this conversation?"], "output": ["requestId": "ask-trello"]
        ]]]]
        conversation["body"] = body
        responses["GET /agent/conversations/push-a"] = conversation
        responses["GET /agent/credential-options"] = ["status": 200, "body": ["options": [
            "trelloIntegrations": [["integrationId": "preview-trello", "label": "Preview Trello", "username": "preview"]]
        ]]]
        responses["PATCH /agent/conversations/push-a/credentials"] = ["status": 200, "body": [:]]
        try JSONSerialization.data(withJSONObject: responses).write(to: live)

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-open-links",
            "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/push-a"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let entry = app.buttons["integration.open"]
        XCTAssertTrue(entry.waitForExistence(timeout: 10))
        entry.tap()
        XCTAssertTrue(app.staticTexts["Connect Trello for this conversation?"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["integration.openConnectors"].exists)
        let detail = XCTAttachment(screenshot: app.screenshot())
        detail.name = "Integration question · fixture · light"
        detail.lifetime = .keepAlways
        add(detail)
        app.buttons["integration.chooseCredentials"].tap()
        XCTAssertTrue(app.staticTexts["Preview Trello"].waitForExistence(timeout: 5))
        app.staticTexts["Preview Trello"].tap()
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(app.buttons["integration.chooseCredentials"].waitForExistence(timeout: 5))
    }
}
