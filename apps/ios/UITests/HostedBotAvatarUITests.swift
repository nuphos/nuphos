import XCTest
import UIKit

final class HostedBotAvatarUITests: XCTestCase {
    func testPhotoAndFailedPhotoEvidence() throws {
        let source = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/hosted-bot-avatars.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: source.deletingLastPathComponent().appending(path: "channel-responses.json"))) as? [String: Any])
        let overrides = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: source)) as? [String: Any])
        let photos = try XCTUnwrap(overrides["photos"] as? [[String: String]])
        for (key, value) in overrides where key != "photos" { responses[key] = value }
        let key = "GET /agent/conversations?kind=channel"
        var listing = responses[key] as! [String: Any]
        var body = listing["body"] as! [String: Any]
        var rows = body["conversations"] as! [[String: Any]]
        for (index, photo) in photos.enumerated() {
            rows[index]["title"] = photo["title"]
            rows[index]["faces"] = [["id": "photo-bot-\(index)", "name": photo["title"]!,
                                     "agent": ["avatar": photo["avatar"]!, "runtime": "codex"]]]
        }
        body["conversations"] = rows
        listing["body"] = body
        responses[key] = listing
        let fixture = URL.temporaryDirectory.appending(path: "hosted-photo-\(UUID()).json")
        try JSONSerialization.data(withJSONObject: responses).write(to: fixture)
        defer { try? FileManager.default.removeItem(at: fixture) }
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()
        XCTAssertTrue(app.staticTexts["Photo Bot"].firstMatch.waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Failed Photo Bot"].firstMatch.exists)
        let photo = app.staticTexts["Photo Bot"].firstMatch
        let failed = app.staticTexts["Failed Photo Bot"].firstMatch
        let loaded = NSPredicate { _, _ in self.isRedAvatar(app, beside: photo) }
        expectation(for: loaded, evaluatedWith: app)
        waitForExpectations(timeout: 8)
        XCTAssertFalse(isRedAvatar(app, beside: failed), "A missing photo must not reuse the other Bot's image")
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "hosted-photo-and-fallback"
        capture.lifetime = .keepAlways
        add(capture)
    }
    private func isRedAvatar(_ app: XCUIApplication, beside label: XCUIElement) -> Bool {
        guard let image = app.screenshot().image.cgImage else { return false }
        let scale = CGFloat(image.width) / app.frame.width
        let point = CGPoint(x: label.frame.minX - 30, y: label.frame.midY)
        guard let pixel = image.cropping(to: CGRect(x: point.x * scale, y: point.y * scale, width: 1, height: 1)) else { return false }
        var bytes = [UInt8](repeating: 0, count: 4)
        let drawn = bytes.withUnsafeMutableBytes { data -> Bool in
            guard let context = CGContext(data: data.baseAddress, width: 1, height: 1, bitsPerComponent: 8,
                                          bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.draw(pixel, in: CGRect(x: 0, y: 0, width: 1, height: 1))
            return true
        }
        return drawn && bytes[0] > 190 && bytes[1] < 90 && bytes[2] < 90
    }
}
