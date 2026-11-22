import XCTest

/// Desktop's runtime picker shows a computer whose agents are all offline as one row, after the
/// rest, with nothing to open. The New Task picker does the same.
final class OfflineComputerPickerUITests: XCTestCase {
    private let team = "64b5f1c2e4b0a1d2c3e4f5a6"

    func testOfflineComputerIsOneRowAfterTheRest() throws {
        let app = try launch()
        let create = app.buttons["Create"]
        XCTAssertTrue(create.waitForExistence(timeout: 15))
        XCTAssertTrue(create.wait(for: \.isEnabled, toEqual: true, timeout: 10))
        create.tap()
        app.buttons["New Task"].tap()
        let choose = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Choose runtime'")).firstMatch
        XCTAssertTrue(choose.waitForExistence(timeout: 5))
        choose.tap()
        XCTAssertTrue(app.navigationBars["Choose runtime"].waitForExistence(timeout: 5))

        let team = box(app, "runtime:rt_team"), online = box(app, "device:demo-macbook"), offline = box(app, "device:studio-mac")
        XCTAssertTrue(offline.waitForExistence(timeout: 5))
        XCTAssertLessThan(team.frame.minY, offline.frame.minY)
        XCTAssertLessThan(online.frame.minY, offline.frame.minY, "The offline computer goes after the online one")
        XCTAssertTrue(app.staticTexts["Offline · open Nuphos on that computer"].exists)
        keep(app, "picker")

        offline.tap()
        XCTAssertFalse(app.buttons["agent-local_preview_studio-mac_claude-code"].waitForExistence(timeout: 1), "An offline computer has nothing to open")
        online.tap()
        XCTAssertTrue(app.buttons["agent-local_preview_demo-macbook_claude-code"].waitForExistence(timeout: 3))
        keep(app, "picker-online-computer")
    }

    private func box(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)["box-\(id)"].firstMatch
    }

    private func keep(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    private func local(_ device: String, _ label: String, _ provider: String, online: Bool, signedIn: Bool) -> [String: Any] {
        ["id": "local_preview_\(device)_\(provider)", "provider": provider, "label": "\(provider == "codex" ? "Codex" : "Claude Code") in \(label)",
         "status": "active", "kind": "local",
         "local": ["ownerUserId": "preview", "deviceId": device, "deviceLabel": label, "online": online, "signedIn": signedIn]]
    }

    private func launch() throws -> XCUIApplication {
        let here = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: here.appending(path: "tests/fixtures/channel-responses.json"))) as? [String: Any])
        let runtimes: [[String: Any]] = [
            ["id": "rt_team", "provider": "claude-code", "label": "Team Claude", "status": "active", "kind": "external"],
            local("studio-mac", "Studio Mac", "claude-code", online: false, signedIn: true),
            local("studio-mac", "Studio Mac", "codex", online: false, signedIn: false),
            local("demo-macbook", "Demo MacBook", "claude-code", online: true, signedIn: true),
        ]
        let devices: [[String: Any]] = [
            ["deviceId": "studio-mac", "label": "Studio Mac", "access": "owner", "online": false, "metricsStatus": "offline", "metrics": NSNull()],
            ["deviceId": "demo-macbook", "label": "Demo MacBook", "access": "owner", "online": true, "metricsStatus": "offline", "metrics": NSNull()],
        ]
        responses["GET /agent/conversations"] = ["status": 200, "body": ["conversations": [], "hasMore": false, "nextCursor": NSNull()]]
        responses["GET /teams/\(team)/agent-runtimes"] = ["status": 200, "body": ["runtimes": runtimes]]
        responses["GET /agent/devices"] = ["status": 200, "body": ["devices": devices]]
        let live = URL.temporaryDirectory.appending(path: "offline-computer-\(UUID().uuidString).json")
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
        addTeardownBlock { try? FileManager.default.removeItem(at: live) }
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        return app
    }
}
