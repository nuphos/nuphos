import XCTest

/// Add computer names the Box option as Desktop does (#3650): one name for one
/// thing in both apps. Uses a copy of the offline chats fixture where a Box can be made.
final class RentComputerUITests: XCTestCase {
    private var live: URL!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "rent-computer-live-\(UUID().uuidString).json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        responses["GET /agent/devices"] = ["status": 200, "body": ["boxAvailable": true, "canCreateBox": true, "devices": []]]
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testTheBoxOptionHasDesktopsName() {
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "runtimes"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let add = app.buttons["Add computer"].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 10), "Computers & runtimes did not open")
        add.tap()
        let option = app.staticTexts["Rent a computer from Nuphos"].firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 10), "The Box option is not named as on Desktop")
        XCTAssertTrue(app.staticTexts["Nuphos runs it for you, with Claude Code, Codex, OpenCode and more."].exists,
                      "The Box option is not described as on Desktop")
        shot("1-add-computer")
        option.tap()
        XCTAssertTrue(app.navigationBars["Rent a computer from Nuphos"].waitForExistence(timeout: 10), "The form is not titled as on Desktop")
        // Too long for a query by label: found by its start, then compared whole.
        let form = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "A Linux computer Nuphos runs")).firstMatch
        XCTAssertTrue(form.exists, "The form is not described as on Desktop")
        XCTAssertEqual(form.label, "A Linux computer Nuphos runs, with Claude Code, Codex, OpenCode and more on it. Running computers count against your plan's vCPU; paused ones do not.")
        shot("2-form")
    }

    /// #3663: runtimes join a new Box one by one and the server lists them in any order,
    /// yet the Ready list keeps Desktop's order, so rows already shown never move.
    func testANewBoxsRuntimesKeepTheirPlaceAsMoreJoin() throws {
        let runtimes = "GET /teams/64b5f1c2e4b0a1d2c3e4f5a6/agent-runtimes"
        func serve(_ joined: [(String, String)]) throws {
            var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: live)) as? [String: Any])
            responses[runtimes] = ["status": 200, "body": ["runtimes": joined.map { provider, name in
                ["id": "box-\(provider)", "provider": provider, "label": name, "status": "active", "kind": "local",
                 "local": ["ownerUserId": "preview", "deviceId": "box-1", "deviceLabel": "Computer 1",
                           "agentLabel": name, "online": true, "signedIn": false]]
            }]]
            responses["POST /agent/devices/boxes"] = ["status": 200, "body": ["deviceId": "box-1"]]
            try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
        }
        try serve([])
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "runtimes"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let add = app.buttons["Add computer"].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 10), "Computers & runtimes did not open")
        add.tap()
        app.staticTexts["Rent a computer from Nuphos"].firstMatch.tap()
        app.buttons["Create computer"].firstMatch.tap()

        // The server lists the first two in reverse of Desktop's order.
        try serve([("pi", "Box Pi"), ("grok", "Box Grok")])
        XCTAssertTrue(app.staticTexts["Box Pi"].waitForExistence(timeout: 15), "The first runtimes did not show")
        XCTAssertEqual(order(app, ["Box Grok", "Box Pi"]), ["Box Grok", "Box Pi"])
        shot("3-first-runtimes")

        // Two more join, again listed out of order: they take their places around the first two.
        try serve([("opencode", "Box OpenCode"), ("pi", "Box Pi"), ("claude-code", "Box Claude Code"), ("grok", "Box Grok")])
        XCTAssertTrue(app.staticTexts["Box Claude Code"].waitForExistence(timeout: 15), "The later runtimes did not show")
        XCTAssertTrue(app.staticTexts["Box OpenCode"].waitForExistence(timeout: 5))
        let all = ["Box Claude Code", "Box Grok", "Box OpenCode", "Box Pi"]
        XCTAssertEqual(order(app, all), all, "The Ready list is not in Desktop's runtime order")
        shot("4-all-runtimes")
    }

    /// The names, top to bottom as shown.
    private func order(_ app: XCUIApplication, _ names: [String]) -> [String] {
        names.sorted { app.staticTexts[$0].firstMatch.frame.minY < app.staticTexts[$1].firstMatch.frame.minY }
    }

    private func shot(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
