import XCTest

/// A conversation started with `nuphos_ask` stores no GitHub key, which the server reads as every
/// installation (#4034). Synthetic accounts only.
final class TeamWideCredentialsUITests: XCTestCase {
    func testAnUnsetGitHubKeyShowsEveryInstallationSelected() throws {
        try assertGitHubShownSelected(stored: ["awsRoleIds": ["preview-aws"]], name: "unset GitHub")
    }

    /// Only empty lists stored: GitHub is still unset, so still every installation.
    func testAnUnsetGitHubKeyBesideEmptyListsShowsSelected() throws {
        try assertGitHubShownSelected(stored: ["awsRoleIds": []], name: "unset GitHub, empty AWS")
    }

    /// Nothing stored at all: the server reads every team-wide kind as unset.
    func testNoStoredSelectionShowsGitHubSelected() throws {
        try assertGitHubShownSelected(stored: nil, name: "nothing stored")
    }

    private func assertGitHubShownSelected(stored: [String: Any]?, name: String) throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/push-responses.json")
        let live = FileManager.default.temporaryDirectory.appending(path: "team-wide-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: live) }
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        var conversation = try XCTUnwrap(responses["GET /agent/conversations/push-a"] as? [String: Any])
        var body = try XCTUnwrap(conversation["body"] as? [String: Any])
        body["credentialAccess"] = stored
        conversation["body"] = body
        responses["GET /agent/conversations/push-a"] = conversation
        responses["GET /agent/conversations?kind=channel"] = ["status": 200, "body": ["conversations": []]]
        responses["GET /agent/credential-options"] = ["status": 200, "body": ["options": [
            "githubInstallations": [["installationId": "preview-github", "accountLogin": "preview-org"]],
        ]]]
        try JSONSerialization.data(withJSONObject: responses).write(to: live)

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent", "-open-links",
            "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/push-a"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        // The composer shows its controls once focused.
        let composer = app.textViews.firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        composer.tap()
        let choose = app.buttons["Choose Credentials"]
        XCTAssertTrue(choose.waitForExistence(timeout: 10))
        choose.tap()
        XCTAssertTrue(app.staticTexts["preview-org"].waitForExistence(timeout: 5))
        let picker = XCTAttachment(screenshot: app.screenshot())
        picker.name = "Credentials · \(name) · fixture · light"
        picker.lifetime = .keepAlways
        add(picker)
        // The only row, the unset GitHub installation, is ticked.
        XCTAssertTrue(app.buttons["Clear all"].waitForExistence(timeout: 5), "An unset GitHub key must show as selected")
    }
}
