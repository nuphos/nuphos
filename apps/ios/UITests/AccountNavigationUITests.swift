import XCTest

final class AccountNavigationUITests: XCTestCase {
    func testNoWorkspaceDoesNotLeaveInboxOrComputersLoading() throws {
        let app = try launchFirstUse(hasTeam: false)
        XCTAssertTrue(app.buttons["Set up workspace"].waitForExistence(timeout: 12))
        XCTAssertFalse(app.buttons["Create"].isEnabled)
        app.tabBars.buttons["Inbox"].tap()
        XCTAssertTrue(app.staticTexts["No workspace yet"].waitForExistence(timeout: 5))
        app.buttons["Computers & runtimes"].tap()
        XCTAssertTrue(app.buttons["Set up workspace"].waitForExistence(timeout: 5))
        captureFirstUse("No workspace — computers")
        let setup = try XCTUnwrap(app.buttons.matching(identifier: "Set up workspace")
            .allElementsBoundByIndex.first(where: { $0.isHittable }), "The visible workspace setup action must be reachable")
        setup.tap()
        XCTAssertTrue(app.textFields["Workspace name"].waitForExistence(timeout: 5))
        captureFirstUse("Workspace setup")
    }

    func testNoRuntimeOffersSetupAndDisablesCreate() throws {
        let app = try launchFirstUse(hasTeam: true)
        XCTAssertTrue(app.buttons["Set up a computer"].waitForExistence(timeout: 12))
        XCTAssertFalse(app.buttons["Create"].isEnabled)
        captureFirstUse("No runtime — home")
        app.buttons["Set up a computer"].tap()
        XCTAssertTrue(app.navigationBars["Runtime setup"].waitForExistence(timeout: 5))
        captureFirstUse("Runtime setup guide")
        app.buttons["Close"].tap()
        app.buttons["Computers & runtimes"].tap()
        XCTAssertTrue(app.buttons["Set up a computer"].waitForExistence(timeout: 5))
        captureFirstUse("No runtime — computers")
    }

    private func launchFirstUse(hasTeam: Bool) throws -> XCUIApplication {
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appending(path: "tests/fixtures/channel-responses.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        if !hasTeam { responses["GET /teams"] = ["status": 200, "body": ["teams": []]] }
        responses["GET /agent/conversations"] = ["status": 200, "body": ["conversations": [], "hasMore": false, "nextCursor": NSNull()]]
        responses["GET /agent/conversations?kind=channel"] = ["status": 200, "body": ["conversations": [], "hasMore": false, "nextCursor": NSNull()]]
        responses["GET /teams/64b5f1c2e4b0a1d2c3e4f5a6/agent-runtimes"] = ["status": 200, "body": ["runtimes": []]]
        let live = URL.temporaryDirectory.appending(path: "first-use-\(UUID()).json")
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        return app
    }

    private func captureFirstUse(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    func testAccountScopesAndProfileEditing() throws {
        continueAfterFailure = false
        let app = launchPreview()
        XCTAssertTrue(app.buttons["Switch team"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Computers & runtimes"].exists)
        XCTAssertFalse(app.navigationBars.buttons["Connectors"].exists)
        shot("home-team-and-computers")
        app.buttons["Switch team"].tap()
        let currentTeam = app.buttons["team-option-64b5f1c2e4b0a1d2c3e4f5a6"]
        XCTAssertTrue(currentTeam.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["team-option-preview-other-team"].isHittable)
        shot("team-switcher")
        currentTeam.tap()
        app.buttons["Computers & runtimes"].tap()
        XCTAssertTrue(app.navigationBars["Computers & runtimes"].waitForExistence(timeout: 5))
        shot("account-external-computers")
        app.buttons["Close workspace"].tap()
        app.buttons["Account"].tap()
        XCTAssertTrue(app.buttons["Close account"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars["Account"].exists)
        XCTAssertFalse(app.buttons["Done"].exists)
        XCTAssertFalse(app.buttons["Edit profile"].exists)
        XCTAssertTrue(app.staticTexts["Signed-in accounts"].exists)
        XCTAssertTrue(app.staticTexts["Integrations"].exists)
        XCTAssertLessThan(app.buttons["Add account"].frame.minY, app.buttons["Connectors"].frame.minY)
        shot("account-overview")
        app.buttons["Connectors"].tap()
        XCTAssertTrue(app.navigationBars["Connectors"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["BackButton"].tap()
        app.buttons["Account options for bruce@example.com"].tap()
        let edit = app.descendants(matching: .any).matching(identifier: "Edit profile").firstMatch
        XCTAssertTrue(edit.waitForExistence(timeout: 5))
        shot("account-options")
        edit.tap()
        XCTAssertTrue(app.navigationBars["Edit profile"].waitForExistence(timeout: 5))
        shot("account-profile-edit")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["Account options for bruce@example.com"].waitForExistence(timeout: 5))
        app.buttons["Close account"].tap()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 5))
    }

    func testDangerZoneKeepsDeletionSeparateFromAccountSignOut() throws {
        continueAfterFailure = false
        let app = launchPreview()
        XCTAssertTrue(app.buttons["Account"].waitForExistence(timeout: 15))
        app.buttons["Account"].tap()
        let deletion = app.buttons["Delete account"]
        for _ in 0..<8 {
            if deletion.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(app.staticTexts["Danger zone"].exists || app.staticTexts["DANGER ZONE"].exists)
        XCTAssertFalse(app.buttons["Sign out"].exists, "Sign-out belongs to the signed-in account options")
        let version = app.staticTexts["account.version"]
        for _ in 0..<5 {
            if version.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(version.isHittable)
        shot("account-version-footer")
        deletion.tap()
        XCTAssertTrue(app.navigationBars["Delete account"].waitForExistence(timeout: 5))
        app.navigationBars.buttons["BackButton"].tap()
        app.buttons["Close account"].tap()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 5))
    }

    private func launchPreview() -> XCUIApplication {
        let app = XCUIApplication()
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        app.launchArguments = ["-preview-home", "-preview-saved-account", "-preview-no-push", "-page", "chats", "-AppleInterfaceStyle", "Light"]
        var responses = try! JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as! [String: Any]
        var teamsEntry = responses["GET /teams"] as! [String: Any]
        var teamsBody = teamsEntry["body"] as! [String: Any]
        var teams = teamsBody["teams"] as! [[String: Any]]
        teams.append(["id": "preview-other-team", "name": "Another shared workspace", "role": "VIEWER"])
        teamsBody["teams"] = teams
        teamsEntry["body"] = teamsBody
        responses["GET /teams"] = teamsEntry
        let responseFile = FileManager.default.temporaryDirectory.appending(path: "account-\(UUID().uuidString).json")
        try! JSONSerialization.data(withJSONObject: responses).write(to: responseFile)
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": responseFile.path]
        app.launch()
        return app
    }

    private func shot(_ name: String) {
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = name
        capture.lifetime = .keepAlways
        add(capture)
    }
}
