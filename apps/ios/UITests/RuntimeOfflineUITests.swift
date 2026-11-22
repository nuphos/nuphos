import XCTest

/// A conversation whose computer is offline says so before the person sends,
/// and offers another runtime (#3167). Uses a copy of the offline chats
/// fixture with the conversation on a computer that is offline.
final class RuntimeOfflineUITests: XCTestCase {
    private let sessionId = "agent-ops"
    private let teamId = "64b5f1c2e4b0a1d2c3e4f5a6"
    private let runtimeId = "local:preview:preview-mac:claude-code"
    private let offline = "The computer running this runtime is offline. Open Nuphos on it, or switch to another runtime."
    private var live: URL!
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "runtime-offline-live-\(UUID().uuidString).json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        responses["GET /agent/conversations/\(sessionId)"] = ["status": 200, "body": conversation()]
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testAnOfflineComputerOffersAnotherRuntimeBeforeSending() throws {
        try launch(online: false)

        XCTAssertTrue(app.collectionViews["chat.transcript"].cells.firstMatch.waitForExistence(timeout: 15), "The conversation did not load")
        XCTAssertTrue(hint.waitForExistence(timeout: 10), "An offline computer is not said before sending")
        let switchRuntime = app.buttons["Switch runtime"].firstMatch
        XCTAssertTrue(switchRuntime.isHittable, "The offline hint does not offer another runtime")
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "runtime-offline-3167-ios"
        capture.lifetime = .keepAlways
        add(capture)

        switchRuntime.tap()
        XCTAssertTrue(app.navigationBars["Choose runtime"].waitForExistence(timeout: 5), "Switch runtime did not open the runtimes")
    }

    func testAnOnlineComputerSaysNothing() throws {
        try launch(online: true)

        XCTAssertTrue(app.collectionViews["chat.transcript"].cells.firstMatch.waitForExistence(timeout: 15), "The conversation did not load")
        XCTAssertFalse(hint.waitForExistence(timeout: 3), "An online computer is called offline")
    }

    // MARK: - Helpers

    /// The hint row, wherever its text sits in the row's label.
    private var hint: XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", offline)).firstMatch
    }

    private func launch(online: Bool) throws {
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: live)) as? [String: Any])
        responses["GET /teams/\(teamId)/agent-runtimes"] = ["status": 200, "body": ["runtimes": [
            ["id": "11111111-1111-4111-8111-111111111111", "provider": "codex", "label": "Preview Codex", "status": "active", "kind": "managed"],
            [
                "id": runtimeId, "provider": "claude-code", "label": "Claude Code in Preview Mac", "status": "active", "kind": "local",
                "local": ["ownerUserId": "preview", "deviceId": "preview-mac", "deviceLabel": "Preview Mac", "online": online, "signedIn": true],
            ],
        ]]]
        try JSONSerialization.data(withJSONObject: responses).write(to: live)
        app = XCUIApplication()
        app.launchArguments = [
            "-preview-home", "-preview-no-push",
            "-open-links", "https://nuphos.ai/teams/\(teamId)/agent/\(sessionId)",
        ]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
    }

    /// An idle conversation the person may move, on the computer's Claude Code.
    private func conversation() -> [String: Any] {
        [
            "sessionId": sessionId,
            "title": "Release ops",
            "messages": [
                ["id": "m0", "role": "user", "parts": [["type": "text", "text": "Is the release ready?"]], "createdAt": "2026-11-03T09:00:00.000Z"],
                ["id": "m1", "role": "assistant", "parts": [["type": "text", "text": "Signing is done. The upload is next."]], "createdAt": "2026-11-03T09:01:00.000Z"],
            ],
            "messagesFirstIndex": 0,
            "messageCount": 2,
            "transcriptUpdatedAt": "2026-11-03T09:01:00.000Z",
            "isOwner": true,
            "canManage": true,
            "readOnly": false,
            "agentRuntime": "claude-code",
            "runtimeId": runtimeId,
            "runtimeLabel": "Claude Code in Preview Mac",
            "runtimeState": [
                "schemaVersion": 2,
                "epoch": "test",
                "revision": 3,
                "state": "idle",
                "phase": "idle",
                "label": "Ready",
                "actions": ["send": true, "cancel": false, "reply": false, "steer": false],
            ],
        ]
    }
}
