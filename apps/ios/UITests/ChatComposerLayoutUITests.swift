import XCTest

/// The composer and the nav bar are see-through and rows scroll on under them,
/// so they need a backing: whatever is scrolled behind, they look the same.
/// Uses a copy of the offline chats fixture with release-planning's posts
/// replaced by a mix of video, words, an image, words and a file.
final class ChatComposerLayoutUITests: XCTestCase {
    func testNothingShowsBehindTheComposer() throws {
        let app = try launch()
        let transcript = app.collectionViews["chat.transcript"]
        // The field is labelled with its placeholder; a plain text with the same label is not the field.
        let composer = app.textViews["Message release-planning"].firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10), "No composer")
        XCTAssertTrue(app.buttons["Open sheet.jpg"].waitForExistence(timeout: 10), "The transcript never loaded")
        sleep(2)
        let bar = app.navigationBars.firstMatch.frame
        let window = app.windows.firstMatch.frame
        // The composer's full width, from just above its field to just below.
        let field = CGRect(x: 0, y: composer.frame.minY - 8, width: window.width, height: composer.frame.height + 16)
        let rest = shot("at-rest")
        let middle = transcript.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
        middle.press(forDuration: 0.1, thenDragTo: middle.withOffset(CGVector(dx: 0, dy: 160)))
        sleep(2)
        let scrolled = shot("mid-scroll")
        let width = window.width
        XCTAssertLessThan(changed(rest, scrolled, in: field, width: width), 0.001, "Rows show through the composer")
        XCTAssertLessThan(changed(rest, scrolled, in: bar, width: width), 0.001, "Rows show through the nav bar")
        composer.tap()
        composer.typeText("A longer draft that wraps onto a second line and then a third, to grow the composer.")
        sleep(2)
        shot("keyboard-draft")
    }

    /// The share of pixels in `rect` (points) that differ visibly between two screenshots.
    private func changed(_ a: XCUIScreenshot, _ b: XCUIScreenshot, in rect: CGRect, width: CGFloat) -> Double {
        func pixels(_ shot: XCUIScreenshot) -> [UInt8] {
            let image = shot.image.cgImage!, scale = CGFloat(image.width) / width
            let crop = image.cropping(to: CGRect(x: rect.minX * scale, y: rect.minY * scale,
                                                         width: rect.width * scale, height: rect.height * scale).integral)!
            var bytes = [UInt8](repeating: 0, count: crop.width * crop.height * 4)
            let context = CGContext(data: &bytes, width: crop.width, height: crop.height, bitsPerComponent: 8,
                                    bytesPerRow: crop.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(crop, in: CGRect(x: 0, y: 0, width: crop.width, height: crop.height))
            return bytes
        }
        let (x, y) = (pixels(a), pixels(b))
        let count = x.count / 4
        let differing = (0..<count).filter { i in (0..<3).contains { abs(Int(x[i * 4 + $0]) - Int(y[i * 4 + $0])) > 8 } }.count
        print("CHANGED \(rect) \(differing)/\(count)")
        return Double(differing) / Double(max(count, 1))
    }

    private func launch() throws -> XCUIApplication {
        let fixtures = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures")
        let live = fixtures.appending(path: "chat-composer-layout-live.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(
            with: Data(contentsOf: fixtures.appending(path: "channel-responses.json"))) as? [String: Any])
        let sender: [String: Any] = ["type": "agent", "id": "agent-ops", "displayName": "Release ops", "agentRuntime": "claude-code"]
        func post(_ id: String, _ minute: Int, _ parts: [[String: Any]]) -> [String: Any] {
            let at = String(format: "2026-11-03T09:%02d:00.000Z", minute)
            return ["id": id, "role": "user", "parts": parts, "createdAt": at,
                    "metadata": ["version": 1, "sender": sender, "sentAt": at, "sourceSessionId": "agent-ops"]]
        }
        func text(_ s: String) -> [String: Any] { ["type": "text", "text": s] }
        func download(_ group: String) -> [String: Any] { ["type": "transfer-download", "groupId": group] }
        let line = "The new opening line lands faster, and the pause before the product name is gone."
        let messages = [
            post("p1", 1, [text("The cut with the new voice-over."), download("g-video")]),
            post("p2", 2, [text("The key frames, one sheet. " + line), download("g-sheet")]),
            post("p3", 3, [text("Both readings of the first sentence, old then new. " + line + " " + line), download("g-audio")]),
            post("p4", 4, [text(Array(repeating: line, count: 4).joined(separator: " "))]),
        ]
        var detail = try XCTUnwrap(responses["GET /agent/conversations/chat-release"] as? [String: Any])
        var body = try XCTUnwrap(detail["body"] as? [String: Any])
        body["messages"] = messages
        body["messageCount"] = messages.count
        body["timelineEvents"] = []
        detail["body"] = body
        responses["GET /agent/conversations/chat-release"] = detail
        func group(_ id: String, _ name: String, _ type: String, _ file: String) -> [String: Any] {
            ["status": 200, "body": ["groupId": id, "createdAt": "2026-11-03T09:00:00.000Z", "expiresAt": "2027-12-31T00:00:00.000Z",
                                     "files": [["id": "f-\(id)", "fileName": name, "contentType": type, "status": "ready",
                                                "downloadUrl": "file://$FIXTURE_DIR/media/\(file)"]]]]
        }
        responses["GET /agent/conversations/chat-release/attachments/g-video"] = group("g-video", "cut.mp4", "video/mp4", "clip.mp4")
        responses["GET /agent/conversations/chat-release/attachments/g-sheet"] = group("g-sheet", "sheet.jpg", "image/jpeg", "wide.png")
        responses["GET /agent/conversations/chat-release/attachments/g-audio"] = group("g-audio", "old-vs-new.m4a", "audio/mp4", "clip.mp4")
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
        addTeardownBlock { try? FileManager.default.removeItem(at: live) }

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        app.staticTexts["release-planning"].firstMatch.tap()
        return app
    }

    @discardableResult
    private func shot(_ name: String) -> XCUIScreenshot {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        return screenshot
    }
}
