import Network
import XCTest

/// A message sent in a Bot's chat says how far its files have uploaded, as a
/// Task's does. The store here takes the connection and never answers, so the
/// upload stays under way. Offline fixture with made-up chats.
final class ChannelUploadProgressUITests: XCTestCase {
    private static let team = "64b5f1c2e4b0a1d2c3e4f5a6"
    private let store = try! NWListener(using: .tcp, on: .any)

    override func tearDown() {
        store.cancel()
    }

    func testASendingPostShowsItsUploadProgress() throws {
        store.newConnectionHandler = { $0.start(queue: .main) }
        let ready = expectation(description: "store listening")
        store.stateUpdateHandler = { if case .ready = $0 { ready.fulfill() } }
        store.start(queue: .main)
        wait(for: [ready], timeout: 5)
        let port = try XCTUnwrap(store.port?.rawValue)

        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/bot-header-responses.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        let files = ["1-Photo.jpg", "2-deploy-notes.pdf"].map { ["relPath": $0, "uploadUrl": "https://127.0.0.1:\(port)/\($0)"] }
        responses["POST /teams/\(Self.team)/file-transfers"] = ["status": 200, "body": ["groupId": "g-up", "files": files]]
        let live = FileManager.default.temporaryDirectory.appending(path: "channel-upload-responses.json")
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats", "-preview-attachments"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let row = app.staticTexts["Trip planner"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "The Bots page does not list Trip planner")
        row.tap()
        XCTAssertTrue(app.collectionViews["chat.transcript"].cells.firstMatch.waitForExistence(timeout: 15), "Trip planner did not load")

        let send = app.buttons["Send"].firstMatch
        XCTAssertTrue(send.waitForExistence(timeout: 10), "The composer has no Send button")
        send.tap()

        let progress = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Uploading'")).firstMatch
        XCTAssertTrue(progress.waitForExistence(timeout: 10), "A sending post does not say how far its files have uploaded")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "channel-upload-progress"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
