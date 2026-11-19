import XCTest

/// #3675: a Box's owner deletes it from Computers & runtimes, with Desktop's confirmation.
/// Uses a copy of the offline Runtimes fixture, rewritten while the app runs.
final class DeleteBoxUITests: XCTestCase {
    private var live: URL!
    private var responses: [String: Any] = [:]

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/runtimes-desktop-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "delete-box-live-\(UUID().uuidString).json")
        responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
    }

    func testTheOwnerDeletesABoxAfterConfirming() throws {
        let mine: [String: Any] = ["deviceId": "box-1", "label": "Computer 1", "access": "owner", "box": ["state": "running"], "metricsStatus": "offline", "metrics": NSNull()]
        let shared: [String: Any] = ["deviceId": "box-2", "label": "Shared Box", "access": "use", "box": ["state": "running"], "metricsStatus": "offline", "metrics": NSNull()]
        devices([mine, shared])
        responses["DELETE /agent/devices/box-1/box"] = ["status": 200, "body": ["ok": true]]
        try write()

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "runtimes"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()

        XCTAssertTrue(app.staticTexts["Shared Box"].waitForExistence(timeout: 30))
        let delete = app.buttons["Delete computer"]
        XCTAssertTrue(delete.waitForExistence(timeout: 5), "Its owner cannot delete a Box")
        XCTAssertEqual(app.buttons.matching(identifier: delete.identifier).count, 1, "A Box shared for use offers Delete too")
        delete.tap()

        let confirm = app.alerts["Delete Computer 1?"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "No confirmation before deleting")
        // The backend no longer lists it once deleted.
        devices([shared])
        try write()
        confirm.buttons["Delete computer"].tap()

        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: app.staticTexts["Computer 1"])
        waitForExpectations(timeout: 15)
        XCTAssertTrue(app.staticTexts["Shared Box"].exists)
    }

    private func devices(_ list: [[String: Any]]) {
        responses["GET /agent/devices"] = ["status": 200, "body": ["boxAvailable": true, "canCreateBox": true, "devices": list]]
    }

    private func write() throws {
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
    }
}
