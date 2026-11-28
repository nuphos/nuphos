import XCTest

/// A group chat's members from its title: adding a Bot or a person, and leaving
/// as a member, as the owner, as the last one, and when the server is away.
final class ChannelMembersUITests: XCTestCase {
    private let chat = "chat-bot-box"
    private let me = "507f1f77bcf86cd799439011"
    private var live: URL!
    private var sent: URL!
    private var responses: [String: Any] = [:]
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/bot-desktop-responses.json")
        responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        live = URL.temporaryDirectory.appending(path: "channel-members-\(UUID()).json")
        sent = URL.temporaryDirectory.appending(path: "channel-members-sent-\(UUID()).jsonl")
        addTeardownBlock { [live, sent] in
            try? FileManager.default.removeItem(at: live!)
            try? FileManager.default.removeItem(at: sent!)
        }
        try makeGroupChat()
    }

    // MARK: - Adding

    func testOwnerAddsABot() throws {
        set("POST /agent/conversations/\(chat)/agents", ["agents": [scribe, critic, atlas]])
        try openMembers(people: [person(me, "Jordan Lee", owner: true), riley], header: "channel-members-ios-header")
        shot("channel-members-ios-owner")
        app.buttons["channel.addBot"].tap()
        let add = app.buttons["channel.addBot.atlas"]
        XCTAssertTrue(add.waitForExistence(timeout: 10), "Atlas was not offered")
        XCTAssertTrue(add.label.contains("Offline"), add.label)
        XCTAssertFalse(app.buttons["channel.addBot.scribe"].exists, "A Bot already in the chat was offered")
        shot("channel-members-ios-add-bot")
        add.tap()
        XCTAssertTrue(waitUntil { !add.exists }, "Atlas stayed offered after it was added")
        XCTAssertEqual(try sentBody("POST /agent/conversations/\(chat)/agents")?["sessionId"] as? String, "atlas")
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(element("channel.bot.atlas").waitForExistence(timeout: 10), "Atlas was not listed after it was added")
    }

    func testOwnerAddsAPerson() throws {
        let morgan = person("morgan", "Morgan Diaz")
        set("GET /teams/64b5f1c2e4b0a1d2c3e4f5a6/members", ["members": [
            member(me, "Jordan Lee"), member("riley", "Riley Chen"), member("morgan", "Morgan Diaz"), member("jo", "Casey Wong"),
        ]])
        set("POST /agent/conversations/\(chat)/participants", access([person(me, "Jordan Lee", owner: true), riley, morgan]))
        try openMembers(people: [person(me, "Jordan Lee", owner: true), riley])
        app.buttons["channel.addPeople"].tap()
        let row = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Morgan Diaz")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "Morgan was not offered")
        // The chat's header behind the sheet names its faces too; only the offered people count.
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND identifier != %@", "Riley Chen", "bot-details-entry")).firstMatch.exists,
                       "Someone already here was offered")
        shot("channel-members-ios-add-people")
        row.tap()
        XCTAssertTrue(waitUntil { !row.exists }, "Morgan stayed offered after joining")
        let body = try XCTUnwrap(sentBody("POST /agent/conversations/\(chat)/participants"))
        XCTAssertEqual(body["userIds"] as? [String], ["morgan"])
        XCTAssertEqual(body["grantComputerUse"] as? Bool, false)
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(element("channel.person.morgan").waitForExistence(timeout: 10), "Morgan was not listed after joining")
    }

    // MARK: - Leaving

    func testMemberLeaves() throws {
        try openMembers(people: [person("riley", "Riley Chen", owner: true), person(me, "Jordan Lee")])
        XCTAssertTrue(app.staticTexts["Only the owner can add people."].exists)
        XCTAssertFalse(app.buttons["channel.addPeople"].exists, "A member was offered Add people")
        shot("channel-members-ios-member")
        try leave(saying: "You can come back only if someone adds you.", shot: "channel-members-ios-leave-member")
        try expectBackOnTheList()
    }

    func testOwnerLeavesAndTheEarliestMemberTakesOver() throws {
        try openMembers(people: [person(me, "Jordan Lee", owner: true), riley, person("sam", "Sam Park")])
        try leave(saying: "Riley Chen becomes the owner. You can come back only if someone adds you.", shot: "channel-members-ios-leave-owner")
        try expectBackOnTheList()
    }

    func testLastPersonLeavingArchivesTheChat() throws {
        try openMembers(people: [person(me, "Jordan Lee", owner: true)])
        try leave(saying: "You’re the last one here, so the chat is archived.", shot: "channel-members-ios-leave-last")
        try expectBackOnTheList()
    }

    func testLeavingWhenTheServerIsAwaySaysSo() throws {
        try openMembers(people: [person("riley", "Riley Chen", owner: true), person(me, "Jordan Lee")])
        set("DELETE /agent/conversations/\(chat)/participants/\(me)",
            ["error": ["message": "Nuphos couldn’t reach the server. Check your connection and try again."]], status: 503)
        try leave(saying: "You can come back only if someone adds you.", shot: nil)
        XCTAssertTrue(app.alerts["Couldn’t leave the chat"].waitForExistence(timeout: 10), "Leaving failed silently")
        shot("channel-members-ios-leave-error")
        app.alerts.buttons["OK"].tap()
        XCTAssertTrue(app.buttons["channel.leave"].exists, "The members closed though leaving failed")
    }

    // MARK: - Steps

    private func openMembers(people: [[String: Any]], header: String? = nil) throws {
        set("GET /agent/conversations/\(chat)/participants", access(people))
        set("DELETE /agent/conversations/\(chat)/participants/\(me)", access(people.filter { $0["id"] as? String != me }), keep: true)
        try save()
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path, "NUPHOS_PREVIEW_REQUESTS": sent.path]
        app.launch()
        let row = app.staticTexts["Launch review"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15)); row.tap()
        let entry = app.buttons["bot-details-entry"]
        XCTAssertTrue(waitUntil { entry.exists && entry.isEnabled }, "The chat's title did not open its members")
        if let header {
            // Once the chat has slid all the way in.
            XCTAssertTrue(waitUntil { entry.isHittable && abs(entry.frame.midX - self.app.frame.midX) < 2 }, "The chat did not finish opening")
            shot(header)
        }
        entry.tap()
        XCTAssertTrue(element("channel.bot.scribe").waitForExistence(timeout: 10), "The members did not open")
        XCTAssertTrue(element("channel.person.\(me)").waitForExistence(timeout: 10), "The chat's people did not load")
    }

    private func leave(saying message: String, shot name: String?) throws {
        app.buttons["channel.leave"].tap()
        XCTAssertTrue(app.staticTexts["Leave “Launch review”?"].waitForExistence(timeout: 10), "Leaving did not ask first")
        XCTAssertTrue(app.staticTexts[message].exists, "The leave dialog did not say: \(message)")
        if let name { shot(name) }
        // Leaving takes the chat off the list, as the server does.
        if name != nil { try dropChatFromList() }
        app.buttons.matching(NSPredicate(format: "label == %@ AND identifier != %@", "Leave chat", "channel.leave")).firstMatch.tap()
    }

    private func expectBackOnTheList() throws {
        XCTAssertTrue(waitUntil { !self.app.buttons["channel.leave"].exists }, "The members stayed open after leaving")
        XCTAssertTrue(waitUntil { !self.app.staticTexts["Launch review"].exists }, "The chat stayed on the list after leaving")
        shot("channel-members-ios-after-leaving")
    }

    // MARK: - Fixture

    private lazy var scribe: [String: Any] = ["sessionId": "scribe", "title": "Launch planner", "ownerId": me, "avatar": "07-ada",
                                              "provider": "claude-code", "presence": ["state": "online"]]
    private lazy var atlas: [String: Any] = ["sessionId": "atlas", "title": "Support Lead", "ownerId": me, "avatar": "02-leonardo",
                                             "provider": "claude-code", "presence": ["state": "offline", "reason": "computer_offline"]]
    private lazy var critic: [String: Any] = ["sessionId": "critic", "title": "Design Critic", "ownerId": "riley", "avatar": "09-frida",
                                              "provider": "claude-code", "presence": ["state": "online"]]
    private let riley = ChannelMembersUITests.person("riley", "Riley Chen")

    private func makeGroupChat() throws {
        let faces: [[String: Any]] = [["id": "scribe", "name": "Launch planner", "agent": ["avatar": "07-ada", "provider": "claude-code"]],
                                      ["id": "riley", "name": "Riley Chen"]]
        try edit("GET /agent/conversations?kind=channel") { body in
            var rows = try XCTUnwrap(body["conversations"] as? [[String: Any]])
            let index = try XCTUnwrap(rows.firstIndex { $0["sessionId"] as? String == chat })
            rows[index]["title"] = "Launch review"
            rows[index]["faces"] = faces
            // With one Bot's face, only this says it is a group chat and not that Bot's own chat.
            rows[index]["group"] = true
            body["conversations"] = rows
        }
        try edit("GET /agent/conversations/\(chat)") { body in
            body["title"] = "Launch review"
            body["group"] = true
            body["faces"] = faces
        }
        set("GET /agent/conversations/\(chat)/agents", ["agents": [scribe, critic]])
        // The viewer's own Bots: one already here, one away.
        let mine = ["teamId": "64b5f1c2e4b0a1d2c3e4f5a6", "messageCount": 1, "createdAt": "2026-11-08T08:00:00Z",
                    "lastActiveAt": "2026-11-08T09:00:00Z", "isOwner": true, "agentRuntime": "claude-code"] as [String: Any]
        set("GET /agent/conversations?bots=true", ["hasMore": false, "conversations": [
            mine.merging(["sessionId": "scribe", "title": "Launch planner", "avatar": "07-ada", "presence": scribe["presence"]!]) { $1 },
            mine.merging(["sessionId": "atlas", "title": "Support Lead", "avatar": "02-leonardo", "presence": atlas["presence"]!]) { $1 },
        ]])
    }

    private func dropChatFromList() throws {
        try edit("GET /agent/conversations?kind=channel") { body in
            body["conversations"] = (body["conversations"] as? [[String: Any]] ?? []).filter { $0["sessionId"] as? String != chat }
        }
        try save()
    }

    private func edit(_ key: String, _ change: (inout [String: Any]) throws -> Void) throws {
        var entry = try XCTUnwrap(responses[key] as? [String: Any], key)
        var body = try XCTUnwrap(entry["body"] as? [String: Any], key)
        try change(&body)
        entry["body"] = body
        responses[key] = entry
    }

    private func set(_ key: String, _ body: Any, status: Int = 200, keep: Bool = false) {
        if keep, responses[key] != nil { return }
        responses[key] = ["status": status, "body": body]
        try? save()
    }

    private func save() throws { try JSONSerialization.data(withJSONObject: responses).write(to: live) }

    private func access(_ people: [[String: Any]]) -> [String: Any] { ["generalAccess": "none", "participants": people] }

    private static func person(_ id: String, _ name: String, owner: Bool = false) -> [String: Any] {
        ["id": id, "name": name, "email": "\(id)@example.com", "avatarURL": "", "isOwner": owner, "role": owner ? "owner" : "reply"]
    }
    private func person(_ id: String, _ name: String, owner: Bool = false) -> [String: Any] { Self.person(id, name, owner: owner) }

    private func member(_ id: String, _ name: String) -> [String: Any] {
        ["id": id, "name": name, "email": "\(id)@example.com", "username": id, "avatarURL": "", "role": "MEMBER"]
    }

    private func sentBody(_ request: String) throws -> [String: Any]? {
        let lines = (try? String(contentsOf: sent, encoding: .utf8))?.split(separator: "\n") ?? []
        return lines.compactMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
            .last { $0["request"] as? String == request }?["body"] as? [String: Any]
    }

    private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    private func waitUntil(timeout: TimeInterval = 10, _ condition: @escaping () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        return condition()
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
