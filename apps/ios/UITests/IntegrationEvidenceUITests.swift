import XCTest

/// Synthetic offline fixtures only; used on disposable evidence branches.
final class IntegrationEvidenceUITests: XCTestCase {
    func testOwner() throws { try capture(owner: true) }
    func testNonOwner() throws { try capture(owner: false) }

    private func capture(owner: Bool) throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/push-responses.json")
        let live = FileManager.default.temporaryDirectory.appending(path: "integration-evidence-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: live) }
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        if !owner {
            responses["GET /teams"] = ["status": 200, "body": ["teams": [[
                "id": "64b5f1c2e4b0a1d2c3e4f5a6", "name": "Preview workspace", "isOwner": false, "role": "EDITOR"
            ]]]]
        }
        var conversation = try XCTUnwrap(responses["GET /agent/conversations/push-a"] as? [String: Any])
        var body = try XCTUnwrap(conversation["body"] as? [String: Any])
        body["title"] = "Trello connection"
        body["isOwner"] = owner
        body["readOnly"] = !owner
        body["credentialAccess"] = ["trelloIntegrationIds": []]
        body["messages"] = [["id": "integration", "role": "assistant", "parts": [[
            "type": "dynamic-tool", "toolCallId": "ask-trello", "toolName": "request_user_decision",
            "state": "output-available", "input": ["label": "Request a Trello connection", "category": "integration", "providers": ["trello"],
                "question": "Connect Trello for this conversation?"], "output": ["requestId": "ask-trello"]
        ]]]]
        conversation["body"] = body
        responses["GET /agent/conversations/push-a"] = conversation
        responses["GET /agent/credential-options"] = ["status": 200, "body": ["options": [
            "trelloIntegrations": [["integrationId": "preview-trello", "label": "Preview Trello", "username": "preview"]]
        ]]]
        responses["GET /teams/64b5f1c2e4b0a1d2c3e4f5a6/connectors"] = ["status": 200, "body": [:]]
        responses["PATCH /agent/conversations/push-a/credentials"] = ["status": 200, "body": [:]]
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-open-links",
            "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/push-a"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let entry = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Request a Trello connection")).firstMatch
        XCTAssertTrue(entry.waitForExistence(timeout: 15))
        shot(app, owner ? "owner-row" : "non-owner-row")
        entry.tap()
        XCTAssertTrue(app.navigationBars.firstMatch.waitForExistence(timeout: 5))
        shot(app, owner ? "owner-detail" : "non-owner-detail")
        let choose = app.buttons["integration.chooseCredentials"]
        if !owner { XCTAssertFalse(choose.exists) }
        if owner && choose.exists {
            choose.tap()
            XCTAssertTrue(app.staticTexts["Preview Trello"].waitForExistence(timeout: 5))
            shot(app, "owner-picker")
            app.staticTexts["Preview Trello"].tap()
            app.buttons["Done"].firstMatch.tap()
            XCTAssertTrue(app.buttons["integration.openConnectors"].waitForExistence(timeout: 5))
            app.buttons["integration.openConnectors"].tap()
            XCTAssertTrue(app.navigationBars["Connectors"].waitForExistence(timeout: 5))
            XCTAssertTrue(app.buttons["Add connector"].waitForExistence(timeout: 5))
            shot(app, "owner-connectors")
        }
        app.terminate()
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
