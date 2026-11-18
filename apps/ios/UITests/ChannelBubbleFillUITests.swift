import XCTest

/// Synthetic offline chat posts; no provider or customer account is used.
/// A post's bubble must stand apart from the transcript behind it, from
/// either side of the chat.
final class ChannelBubbleFillUITests: XCTestCase {
    private let theirs = "A reply from the Bot."
    private let mine = "A reply from me."

    func testBubblesAreFilledInLightAppearance() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        var detail = try XCTUnwrap(responses["GET /agent/conversations/chat-release"] as? [String: Any])
        var body = try XCTUnwrap(detail["body"] as? [String: Any])
        body["messages"] = [
            post("theirs", text: theirs, sender: ["type": "agent", "id": "agent-ops", "displayName": "Preview Bot"]),
            // The preview account's own id, so this post is drawn as the viewer's.
            post("mine", text: mine, sender: ["type": "user", "id": "507f1f77bcf86cd799439011", "displayName": "Bruce Wayne"]),
        ]
        body["messageCount"] = 2
        body["timelineEvents"] = []
        detail["body"] = body
        responses["GET /agent/conversations/chat-release"] = detail
        let live = FileManager.default.temporaryDirectory.appending(path: "bubble-fill-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: live) }
        try JSONSerialization.data(withJSONObject: responses).write(to: live)

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent", "-open-links",
            "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/chat-release",
            "-AppleInterfaceStyle", "Light"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        // Cells: the timestamp, the Bot's post, then the viewer's.
        let transcript = app.collectionViews["chat.transcript"]
        XCTAssertTrue(transcript.cells.element(boundBy: 2).waitForExistence(timeout: 15))
        // Sample once the push has finished sliding the chat in.
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: transcript)
        XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 10), .completed)
        sleep(1)
        continueAfterFailure = true
        let theirText = text(in: transcript.cells.element(boundBy: 1))
        let myText = text(in: transcript.cells.element(boundBy: 2))

        let screenshot = app.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = "bubbles-light"
        attachment.lifetime = .keepAlways
        add(attachment)
        let pixels = try XCTUnwrap(Pixels(screenshot.image))

        // Inside the bubble's 14pt horizontal padding, against the transcript
        // well outside it, on the same line.
        let their = theirText.frame
        XCTAssertLessThan(their.width, 300, "expected the Bot's text, found \(theirText.debugDescription)")
        assertFilled(pixels, inside: CGPoint(x: their.minX - 7, y: their.midY),
                     outside: CGPoint(x: their.maxX + 40, y: their.midY), "the Bot's bubble")
        let my = myText.frame
        assertFilled(pixels, inside: CGPoint(x: my.maxX + 7, y: my.midY),
                     outside: CGPoint(x: my.minX - 40, y: my.midY), "the viewer's bubble")
    }

    private func assertFilled(_ pixels: Pixels, inside: CGPoint, outside: CGPoint, _ name: String,
                              file: StaticString = #filePath, line: UInt = #line) {
        let fill = pixels.color(at: inside), page = pixels.color(at: outside)
        let distance = zip(fill, page).map { abs(Int($0) - Int($1)) }.reduce(0, +)
        XCTAssertGreaterThan(distance, 12, "\(name) is \(fill), the same as the transcript behind it (\(page))",
                             file: file, line: line)
    }

    /// A post's text, the innermost view of its cell; its bubble pads it by 14pt.
    private func text(in cell: XCUIElement) -> XCUIElement {
        cell.descendants(matching: .other).allElementsBoundByIndex.last ?? cell
    }

    private func post(_ id: String, text: String, sender: [String: Any]) -> [String: Any] {
        var metadata: [String: Any] = ["version": 1, "sender": sender, "sentAt": "2026-11-03T09:23:00.000Z"]
        if sender["type"] as? String == "agent" { metadata["sourceSessionId"] = sender["id"] }
        return ["id": id, "role": "user", "parts": [["type": "text", "text": text]],
         "metadata": metadata,
         "createdAt": "2026-11-03T09:23:00.000Z"]
    }
}

/// RGB of a screenshot, addressed in points.
private struct Pixels {
    let data: [UInt8]
    let width: Int
    let height: Int
    let scale: CGFloat

    init?(_ image: UIImage) {
        guard let cg = image.cgImage else { return nil }
        width = cg.width
        height = cg.height
        scale = CGFloat(cg.width) / image.size.width
        var data = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = data.withUnsafeMutableBytes { buffer in
            CGContext(data: buffer.baseAddress, width: cg.width, height: cg.height, bitsPerComponent: 8,
                      bytesPerRow: cg.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue).map {
                $0.draw(cg, in: CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
                return true
            } ?? false
        }
        guard drawn else { return nil }
        self.data = data
    }

    func color(at point: CGPoint) -> [UInt8] {
        let x = min(max(Int(point.x * scale), 0), width - 1)
        let y = min(max(Int(point.y * scale), 0), height - 1)
        let index = (y * width + x) * 4
        return Array(data[index..<index + 3])
    }
}
