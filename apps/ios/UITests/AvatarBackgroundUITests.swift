import XCTest

/// A Bot's picked background is a disc in its tint behind the character, in the
/// chat list and in the chat itself; None looks as before (#3504). Offline fixtures only.
final class AvatarBackgroundUITests: XCTestCase {
    private var live: URL?
    /// Sky (`avatar.sky`, #D6E6F7) in light mode.
    private let sky: (Int, Int, Int) = (0xD6, 0xE6, 0xF7)

    override func tearDown() {
        if let live { try? FileManager.default.removeItem(at: live) }
    }

    func testPickedBackgroundShowsInListAndChat() throws {
        let plain = try skyPixels(background: nil)
        let tinted = try skyPixels(background: "sky")
        // The list's 36 pt face and the chat's faces each paint a disc; None paints none.
        XCTAssertGreaterThan(tinted.list, plain.list + 40, "list: \(tinted.list) sky pixels vs \(plain.list) with None")
        XCTAssertGreaterThan(tinted.chat, plain.chat + 40, "chat: \(tinted.chat) sky pixels vs \(plain.chat) with None")
    }

    /// Pixels of the Sky tint on the chat list, then in the opened chat.
    private func skyPixels(background: String?) throws -> (list: Int, chat: Int) {
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/bot-desktop-responses.json")
        let file = fixture.deletingLastPathComponent().appending(path: "avatar-background-\(UUID().uuidString).json")
        if let live { try? FileManager.default.removeItem(at: live) }
        live = file
        var agent: [String: Any] = ["avatar": "07-ada", "provider": "codex"]
        if let background { agent["avatarBackground"] = background }
        let faces: [[String: Any]] = [["id": "bot-plain", "name": "bot-plain", "agent": agent]]
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        let listKey = "GET /agent/conversations?kind=channel"
        var listing = try XCTUnwrap(responses[listKey] as? [String: Any])
        var body = try XCTUnwrap(listing["body"] as? [String: Any])
        var rows = try XCTUnwrap(body["conversations"] as? [[String: Any]])
        let index = try XCTUnwrap(rows.firstIndex { $0["sessionId"] as? String == "chat-bot-plain" })
        rows[index]["faces"] = faces
        body["conversations"] = rows
        listing["body"] = body
        responses[listKey] = listing
        let detailKey = "GET /agent/conversations/chat-bot-plain"
        var detail = try XCTUnwrap(responses[detailKey] as? [String: Any])
        var chat = try XCTUnwrap(detail["body"] as? [String: Any])
        chat["faces"] = faces
        detail["body"] = chat
        responses[detailKey] = detail
        // The Bot's own row and the chat's agents carry the same tint, as the backend sends them.
        for key in ["GET /agent/conversations", "GET /agent/conversations/chat-bot-plain/agents"] {
            guard var entry = responses[key] as? [String: Any], var list = entry["body"] as? [String: Any] else { continue }
            let field = list["conversations"] != nil ? "conversations" : "agents"
            var items = list[field] as? [[String: Any]] ?? []
            for i in items.indices where items[i]["sessionId"] as? String == "bot-plain" {
                items[i]["avatar"] = "07-ada"
                items[i]["avatarBackground"] = background
            }
            list[field] = items
            entry["body"] = list
            responses[key] = entry
        }
        try JSONSerialization.data(withJSONObject: responses).write(to: file, options: .atomic)

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats", "-AppleInterfaceStyle", "Light"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": file.path]
        app.launch()
        let row = app.staticTexts["Release notes"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        let list = count(in: app, shot: "list-\(background ?? "none")")
        row.tap()
        XCTAssertTrue(app.staticTexts["Release notes"].firstMatch.waitForExistence(timeout: 10))
        sleep(1)
        let opened = count(in: app, shot: "chat-\(background ?? "none")")
        app.terminate()
        return (list, opened)
    }

    private func count(in app: XCUIApplication, shot name: String) -> Int {
        let screenshot = app.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = "avatar-background-" + name
        attachment.lifetime = .keepAlways
        add(attachment)
        guard let image = screenshot.image.cgImage else { return 0 }
        let width = image.width, height = image.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let drawn: Bool = pixels.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(
                data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return 0 }
        var matches = 0
        for offset in stride(from: 0, to: pixels.count, by: 4)
        where abs(Int(pixels[offset]) - sky.0) <= 4 && abs(Int(pixels[offset + 1]) - sky.1) <= 4
            && abs(Int(pixels[offset + 2]) - sky.2) <= 4 {
            matches += 1
        }
        return matches
    }
}
