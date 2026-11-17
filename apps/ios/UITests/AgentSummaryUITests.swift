import XCTest

final class AgentSummaryUITests: XCTestCase {
    func testSummaryShowsConversationContextWithoutMacDock() throws {
        continueAfterFailure = false
        let app = launch()
        let button = app.buttons["agent-summary-button"]
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "1 merged")).count, 0)
        button.tap()
        XCTAssertTrue(app.staticTexts["Task summary"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["dock-search"].exists)
        XCTAssertFalse(app.buttons["dock-new-tab"].exists)
        XCTAssertTrue(app.staticTexts["Ship the release after checks pass?"].waitForExistence(timeout: 10))
        shot("agent-summary-top")
        app.staticTexts["Ship the release after checks pass?"].tap()
        XCTAssertTrue(app.buttons["Ship it"].waitForExistence(timeout: 5))
        app.buttons["Close question"].tap()
        for _ in 0..<4 {
            if app.staticTexts["Improve mobile navigation"].isHittable { break }
            app.scrollViews["agent-summary-list"].swipeUp()
        }
        XCTAssertTrue(app.staticTexts["Improve mobile navigation"].exists)
        XCTAssertTrue(app.staticTexts["Review accessibility"].exists)
        shot("agent-summary-work")
        for _ in 0..<4 {
            if app.staticTexts["Daily release check"].isHittable { break }
            app.scrollViews["agent-summary-list"].swipeUp()
        }
        XCTAssertTrue(app.staticTexts["Daily release check"].exists)
        XCTAssertTrue(app.buttons["Close summary"].isHittable)
        shot("agent-summary-files-and-schedules")
        app.buttons["Close summary"].tap()
        XCTAssertTrue(button.waitForExistence(timeout: 5))
    }

    func testSummaryEmptyStateDoesNotShowWorkspaceNavigation() throws {
        continueAfterFailure = false
        let app = launch(empty: true)
        let button = app.buttons["agent-summary-button"]
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        button.tap()
        XCTAssertTrue(app.staticTexts["No questions waiting for you."].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Favorites"].exists)
        XCTAssertFalse(app.textFields["dock-search"].exists)
        shot("agent-summary-empty")
        app.buttons["Close summary"].tap()
    }

    private func launch(empty: Bool = false) -> XCUIApplication {
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/agent-summary-responses.json")
        var responses = try! JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as! [String: Any]
        if empty {
            var detail = responses["GET /agent/conversations/dock-a"] as! [String: Any]
            var body = detail["body"] as! [String: Any]
            body["runtimeState"] = ["schemaVersion": 2, "state": "idle", "phase": "idle"]
            detail["body"] = body
            responses["GET /agent/conversations/dock-a"] = detail
            var parent = body
            parent["inputRequests"] = []
            responses["GET /agent/conversations"] = ["status": 200, "body": ["conversations": [parent], "hasMore": false]]
            responses["GET /agent/conversations?pendingDecision=true"] = ["status": 200, "body": ["conversations": [], "hasMore": false]]
            responses["GET /agent/conversations/dock-a/resources"] = ["status": 200, "body": ["resources": []]]
            responses["GET /agent/triggers"] = ["status": 200, "body": []]
            responses["GET /agent-sessions/dock-a/teams/64b5f1c2e4b0a1d2c3e4f5a6/file-transfers/downloads"] = ["status": 200, "body": ["groups": []]]
        }
        let file = FileManager.default.temporaryDirectory.appending(path: "summary-\(UUID().uuidString).json")
        try! JSONSerialization.data(withJSONObject: responses).write(to: file)
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-open-links", "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/dock-a", "-AppleInterfaceStyle", "Light"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": file.path]
        app.launch()
        return app
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
