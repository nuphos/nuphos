import Foundation

enum ChannelPostTests {
    static func run() {
        readsPeopleAgentsAndFiles()
        skipsMessagesWithoutASenderOrContent()
        startsARunAtEachNewSender()
        putsATimeAboveAPostAfterAPause()
        keepsSendingPostsUntilTheChatReturnsThem()
        placesPausedLinesAndTypingInOrder()
        decodesChatsFromTheList()
        renamingTheBotChangesTheRevision()
        print("Chat posts, runs, sending and timeline passed")
    }

    private static func message(_ id: String, sender: [String: JSONValue], source: String? = nil, sentAt: String = "2026-11-03T09:00:00.000Z",
                                parts: [JSONValue]) -> ChatMessage {
        var metadata: [String: JSONValue] = ["version": .number(1), "sender": .object(sender), "sentAt": .string(sentAt)]
        if let source { metadata["sourceSessionId"] = .string(source) }
        var message = ChatMessage(id: id, role: .user, parts: parts.map(ChatPart.init(json:)), createdAt: nil)
        message.metadata = .object(metadata)
        return message
    }

    private static func person(_ id: String, _ name: String) -> [String: JSONValue] {
        ["type": .string("user"), "id": .string(id), "displayName": .string(name)]
    }

    private static let agent: [String: JSONValue] = [
        "type": .string("agent"), "id": .string("agent-1"), "displayName": .string("Ops"), "agentRuntime": .string("codex"),
    ]

    private static func text(_ value: String) -> JSONValue { .object(["type": .string("text"), "text": .string(value)]) }

    private static func readsPeopleAgentsAndFiles() {
        let upload: JSONValue = .object([
            "type": .string("transfer-upload"), "groupId": .string("g-up"), "status": .string("ready"),
            "files": .array([.object(["fileName": .string("crash.png"), "size": .number(10)])]),
        ])
        let mine = ChannelPost(message("m1", sender: person("me", "Bruce"), parts: [text("Look"), upload]))!
        precondition(mine.text == "Look" && !mine.isAgent && mine.isMine(viewerId: "me") && !mine.isMine(viewerId: "other"))
        precondition(mine.uploads.map(\.groupId) == ["g-up"] && mine.uploads.first?.files.first?.fileName == "crash.png")
        precondition(mine.sentAt == ISO8601DateFormatter().date(from: "2026-11-03T09:00:00Z"))

        let pushed: JSONValue = .object(["type": .string("transfer-download"), "groupId": .string("g-1")])
        let pushed2: JSONValue = .object(["type": .string("transfer-download"), "groupId": .string("g-2")])
        let reply = ChannelPost(message("m2", sender: agent, source: "agent-1", parts: [text("Done"), pushed, pushed2]))!
        // An agent's own words are never the viewer's, even under a matching id.
        precondition(reply.isAgent && reply.senderId == "agent-1" && !reply.isMine(viewerId: "agent-1"))
        precondition(reply.runtime == "codex" && reply.downloads == ["g-1", "g-2"])
        // A file may go without words, as in any chat.
        precondition(ChannelPost(message("m3", sender: person("me", "Bruce"), parts: [upload]))?.text == "")
    }

    private static func skipsMessagesWithoutASenderOrContent() {
        precondition(ChannelPost(ChatMessage.user("no metadata")) == nil)
        precondition(ChannelPost(message("m", sender: person("me", "Bruce"), parts: [])) == nil)
        precondition(ChannelPost(message("m", sender: ["type": .string("user"), "id": .string("me")], parts: [text("hi")])) == nil)
        // A chat shows only what people and agents post, never a system notice.
        let system: [String: JSONValue] = ["type": .string("system"), "id": .string("nuphos"), "displayName": .string("Nuphos")]
        precondition(ChannelPost(message("m", sender: system, parts: [text("Release Helper finished a turn.")])) == nil)
    }

    private static func post(_ id: String, _ sender: String, at seconds: TimeInterval, sending: Bool = false) -> ChannelPost {
        ChannelPost(id: id, senderId: sender, isAgent: false, name: sender, text: id,
                    sentAt: Date(timeIntervalSince1970: seconds), sending: sending)
    }

    private static func firsts(_ items: [(id: String, item: ChannelItem)]) -> [String] {
        items.compactMap { if case .post(let post, true) = $0.item { return post.id }; return nil }
    }

    private static func startsARunAtEachNewSender() {
        let items = ChannelPost.items(posts: [post("a", "x", at: 1), post("b", "x", at: 2), post("c", "y", at: 3), post("d", "x", at: 4)],
                                      events: [], typing: [])
        precondition(firsts(items) == ["a", "c", "d"])
    }

    private static func putsATimeAboveAPostAfterAPause() {
        let items = ChannelPost.items(posts: [post("a", "x", at: 0), post("b", "x", at: 60), post("c", "x", at: 60 + ChatTime.separatorInterval + 1)],
                                      events: [], typing: [])
        precondition(items.map(\.id) == ["time.a", "post.a", "post.b", "time.c", "post.c"])
        // The sender's name shows again under the time.
        precondition(firsts(items) == ["a", "c"])
    }

    private static func keepsSendingPostsUntilTheChatReturnsThem() {
        let sending = [post("s1", "me", at: 5, sending: true), post("s2", "me", at: 6, sending: true)]
        precondition(ChannelPost.stillSending(stored: [post("s1", "me", at: 5)], sending: sending).map(\.id) == ["s2"])
        precondition(ChannelPost.stillSending(stored: [], sending: sending).count == 2)
        // A post on its way is the newest even when this device's clock runs behind.
        let items = ChannelPost.items(posts: [post("old", "x", at: 100), post("s", "me", at: 1, sending: true)], events: [], typing: [])
        precondition(items.map(\.id) == ["time.old", "post.old", "post.s"])
        // After a pause it carries its time while sending, so being returned changes no rows.
        let later = 100 + ChatTime.separatorInterval + 1
        let sent = ChannelPost.items(posts: [post("old", "x", at: 100), post("s", "me", at: later, sending: true)], events: [], typing: [])
        let returned = ChannelPost.items(posts: [post("old", "x", at: 100), post("s", "me", at: later)], events: [], typing: [])
        precondition(sent.map(\.id) == ["time.old", "post.old", "time.s", "post.s"] && returned.map(\.id) == sent.map(\.id))
    }

    private static func placesPausedLinesAndTypingInOrder() {
        let paused = AgentConversationDetail.TimelineEvent(at: Date(timeIntervalSince1970: 2.5), text: "Agents paused", kind: "agents_paused")
        let joined = AgentConversationDetail.TimelineEvent(at: Date(timeIntervalSince1970: 1.5), text: "Clark joined")
        let failed = AgentConversationDetail.TimelineEvent(at: Date(timeIntervalSince1970: 3.5), text: "Ops couldn’t reply.", kind: "agent_reply_failed")
        let typing = [ChannelAgent(sessionId: "agent-1", title: "Ops", ownerId: "me")]
        let items = ChannelPost.items(posts: [post("a", "x", at: 1), post("b", "x", at: 2), post("c", "x", at: 3)],
                                      events: [paused, joined, failed], typing: typing)
        precondition(items.map(\.id) == ["time.a", "post.a", "post.b", "paused.2.5", "post.c", "paused.3.5", "typing"])
        precondition(items[5].item == .paused("Ops couldn’t reply."))
        precondition(items.last?.item == .typing(typing))
        // The line between two posts does not split their sender's run.
        precondition(firsts(items) == ["a"])
        precondition(ChannelPost.items(posts: [], events: [], typing: []).isEmpty)
    }

    private static func decodesChatsFromTheList() {
        let json = #"{"conversations":[{"sessionId":"c1","title":"release","kind":"channel","activitySeq":3,"readSeq":1},{"sessionId":"a1","title":"agent"}],"hasMore":false}"#
        let page = try! JSONDecoder().decode(AgentConversationsPage.self, from: Data(json.utf8))
        precondition(page.conversations.map(\.isChannel) == [true, false])
        let detail = try! JSONDecoder().decode(AgentConversationDetail.self, from: Data(
            #"{"kind":"channel","messageCount":4,"transcriptUpdatedAt":"t"}"#.utf8))
        precondition(detail.isChannel && detail.messageCount == 4 && detail.transcriptUpdatedAt == "t")
    }

    private static func renamingTheBotChangesTheRevision() {
        func probe(title: String, avatar: String = "05", count: Int = 3) -> AgentConversationDetail {
            let json = #"{"kind":"channel","title":"\#(title)","transcriptUpdatedAt":"t1","messageCount":\#(count),"messages":[],"faces":[{"id":"bot-1","name":"\#(title)","agent":{"avatar":"\#(avatar)"}}]}"#
            return try! JSONDecoder().decode(AgentConversationDetail.self, from: Data(json.utf8))
        }
        let helper = probe(title: "Helper")
        precondition(probe(title: "Helper").channelRevision == helper.channelRevision, "an unchanged chat keeps its revision")
        precondition(probe(title: "Scout").channelRevision != helper.channelRevision, "renaming the Bot changes it without a post")
        precondition(probe(title: "Helper", avatar: "07").channelRevision != helper.channelRevision, "a new face changes it")
        precondition(probe(title: "Helper", count: 4).channelRevision != helper.channelRevision, "a new post still changes it")
    }
}
