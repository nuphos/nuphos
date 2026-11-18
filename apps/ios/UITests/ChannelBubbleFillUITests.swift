import XCTest

/// Synthetic offline chat posts; no provider or customer account is used.
/// A post's bubble must stand apart from the transcript behind it, from
/// either side of the chat.
final class ChannelBubbleFillUITests: XCTestCase {
    private let theirs = "A reply from the Bot."
    private let mine = "A reply from me."
    private let teammate = "A reply from a teammate."

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
            post("teammate", text: teammate, sender: ["type": "user", "id": "5f1b2c3d4e5f60718293a4b5", "displayName": "Diana Prince"]),
            // The preview account's own id, so this post is drawn as the viewer's.
            post("mine", text: mine, sender: ["type": "user", "id": "507f1f77bcf86cd799439011", "displayName": "Bruce Wayne"]),
        ]
        body["messageCount"] = 3
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
        // Cells: the timestamp, the Bot's post, the teammate's, then the viewer's.
        let transcript = app.collectionViews["chat.transcript"]
        XCTAssertTrue(transcript.cells.element(boundBy: 3).waitForExistence(timeout: 15))
        settle(transcript)
        continueAfterFailure = true
        let theirText = text(in: transcript.cells.element(boundBy: 1))
        let teammateText = text(in: transcript.cells.element(boundBy: 2))
        let myText = text(in: transcript.cells.element(boundBy: 3))

        let screenshot = app.screenshot()
        keep(screenshot, "bubbles-light")
        let pixels = try XCTUnwrap(Pixels(screenshot.image))

        // Inside the bubble's 14pt horizontal padding, against the transcript
        // well outside it, on the same line.
        let their = theirText.frame
        XCTAssertLessThan(their.width, 300, "expected the Bot's text, found \(theirText.debugDescription)")
        assertFilled(pixels, inside: CGPoint(x: their.minX - 7, y: their.midY),
                     outside: CGPoint(x: their.maxX + 40, y: their.midY), "the Bot's bubble")
        let theirs2 = teammateText.frame
        assertFilled(pixels, inside: CGPoint(x: theirs2.minX - 7, y: theirs2.midY),
                     outside: CGPoint(x: theirs2.maxX + 40, y: theirs2.midY), "a teammate's bubble")
        let my = myText.frame
        assertFilled(pixels, inside: CGPoint(x: my.maxX + 7, y: my.midY),
                     outside: CGPoint(x: my.minX - 40, y: my.midY), "the viewer's bubble")
    }

    /// A chip and a card inside a Task's transcript: an answered question's
    /// answer, and the card it opens to.
    func testAnsweredChipAndCardAreFilledInLightAppearance() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/push-responses.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        var conversation = try XCTUnwrap(responses["GET /agent/conversations/push-a"] as? [String: Any])
        var body = try XCTUnwrap(conversation["body"] as? [String: Any])
        body["messages"] = [
            ["id": "ask-q-1", "role": "assistant", "createdAt": "2026-11-14T01:12:00Z", "parts": [[
                "type": "dynamic-tool", "toolCallId": "q-1", "toolName": "request_user_decision", "state": "output-available",
                "input": ["category": "approval", "question": "Ship it?", "options": ["Ship", "Wait"]],
                "output": ["requestId": "q-1"]]]],
            ["id": "notice-q-1", "role": "user", "createdAt": "2026-11-14T01:47:00Z",
             "parts": [["type": "text", "text": [
                "Your question (requestId q-1) was answered from the Inbox.",
                "Answered by: \"Jamie Doe\", this conversation's owner: it is their own answer.",
                "Question: Ship it?", "Options: Ship | Wait", "Answer:", "- Ship it? → Ship",
                "Continue the task with this answer."].joined(separator: "\n")]],
             "metadata": ["version": 1, "source": "agent.resource", "sentAt": "2026-11-14T01:47:00Z",
                          "sender": ["type": "system", "id": "nuphos:decision", "displayName": "Nuphos"]]],
        ]
        conversation["body"] = body
        responses["GET /agent/conversations/push-a"] = conversation
        responses["GET /agent/conversations?kind=channel"] = ["status": 200, "body": ["conversations": []]]
        let live = FileManager.default.temporaryDirectory.appending(path: "answered-fill-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: live) }
        try JSONSerialization.data(withJSONObject: responses).write(to: live)

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent", "-open-links",
            "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/push-a"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let line = app.buttons.matching(identifier: "answered.line").firstMatch
        XCTAssertTrue(line.waitForExistence(timeout: 15))
        settle(app.collectionViews["chat.transcript"])
        continueAfterFailure = true

        // The answer chip pads its text by 10pt; sample beside the text, and
        // the row above the 24pt capsule.
        let answer = line.staticTexts["Ship"].firstMatch
        XCTAssertTrue(answer.exists, "expected the answer chip in \(line.debugDescription)")
        let collapsed = app.screenshot()
        keep(collapsed, "answered-chip-light")
        let chip = answer.frame
        assertFilled(try XCTUnwrap(Pixels(collapsed.image)), inside: CGPoint(x: chip.maxX + 5, y: chip.midY),
                     outside: CGPoint(x: chip.maxX + 5, y: chip.midY - 20), "the answer chip")

        line.tap()
        let card = app.descendants(matching: .any).matching(identifier: "answered.card").firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        sleep(1)
        let expanded = app.screenshot()
        keep(expanded, "answered-card-light")
        // The card pads its question by 16pt and sits 16pt in from the transcript's edge.
        // It is raised, nearly the transcript's own color, so its ring is what sets it apart.
        let titles = app.staticTexts.matching(NSPredicate(format: "label == 'Ship it?'")).allElementsBoundByIndex
        let title = try XCTUnwrap(titles.max { $0.frame.minY < $1.frame.minY }).frame
        let pixels = try XCTUnwrap(Pixels(expanded.image))
        let page = CGPoint(x: title.minX - 26, y: title.midY)
        let edge = stride(from: title.minX - 8, through: title.minX - 22, by: -0.25).map { CGPoint(x: $0, y: title.midY) }
        XCTAssertTrue(edge.contains { distance(pixels.color(at: $0), pixels.color(at: page)) > 12 },
                      "the answered question's card has no edge against the transcript (\(pixels.color(at: page)))")
    }

    /// Waits for the push to finish sliding the chat in, so pixels are read
    /// where the frames say.
    private func settle(_ transcript: XCUIElement) {
        let inPlace = NSPredicate { _, _ in transcript.exists && transcript.frame.minX == 0 }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: inPlace, object: nil)], timeout: 10),
                       .completed, "The chat did not finish opening")
        sleep(1)
    }

    private func keep(_ screenshot: XCUIScreenshot, _ name: String) {
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func assertFilled(_ pixels: Pixels, inside: CGPoint, outside: CGPoint, _ name: String,
                              file: StaticString = #filePath, line: UInt = #line) {
        let fill = pixels.color(at: inside), page = pixels.color(at: outside)
        XCTAssertGreaterThan(distance(fill, page), 12, "\(name) is \(fill), the same as the transcript behind it (\(page))",
                             file: file, line: line)
    }

    private func distance(_ a: [UInt8], _ b: [UInt8]) -> Int {
        zip(a, b).map { abs(Int($0) - Int($1)) }.reduce(0, +)
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
