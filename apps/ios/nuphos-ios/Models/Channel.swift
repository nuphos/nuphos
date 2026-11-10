import Foundation

/// An agent brought into a chat (`GET /agent/conversations/:id/agents`).
struct ChannelAgent: Decodable, Equatable, Identifiable, Sendable {
    let sessionId: String
    let title: String
    let ownerId: String
    var id: String { sessionId }
}

/// The post a reply answers, as the server quoted it when the reply was sent.
struct ChannelReply: Equatable, Sendable {
    /// The original's id in this chat; it may since be gone.
    let id: String?
    let authorName: String
    let text: String
}

/// One post in a chat, read from the stored message as the desktop's
/// `ChannelMessage` reads it: who sent it, its words, and its files.
struct ChannelPost: Equatable, Identifiable, Sendable {
    let id: String
    /// The sender's id; an agent's is its session. Consecutive posts from one sender form a run.
    let senderId: String
    let isAgent: Bool
    let name: String
    let avatar: URL?
    let runtime: String?
    let text: String
    /// A person's uploads.
    let uploads: [TransferUpload]
    /// An agent's pushed files, as their transfer groups.
    let downloads: [String]
    let sentAt: Date?
    /// The post this one replies to.
    let replyTo: ChannelReply?
    /// Shown at once, before the chat returns it.
    var sending = false

    init(id: String, senderId: String, isAgent: Bool, name: String, avatar: URL? = nil, runtime: String? = nil,
         text: String, uploads: [TransferUpload] = [], downloads: [String] = [], sentAt: Date?,
         replyTo: ChannelReply? = nil, sending: Bool = false) {
        self.id = id
        self.senderId = senderId
        self.isAgent = isAgent
        self.name = name
        self.avatar = avatar
        self.runtime = runtime
        self.text = text
        self.uploads = uploads
        self.downloads = downloads
        self.sentAt = sentAt
        self.replyTo = replyTo
        self.sending = sending
    }

    /// Nil for a message without a sender, with nothing to show, or not posted
    /// by a person or an agent: a chat shows only their posts.
    init?(_ message: ChatMessage) {
        let metadata = message.metadata
        guard let sender = metadata?["sender"], let type = sender["type"]?.stringValue,
              type == "user" || type == "agent",
              let senderId = metadata?["sourceSessionId"]?.stringValue ?? sender["id"]?.stringValue,
              let attributed = message.sender else { return nil }
        let uploads = message.parts.compactMap(TransferUpload.init)
        let downloads = message.parts.compactMap { part -> String? in
            guard case .other(let json) = part, json["type"]?.stringValue == "transfer-download" else { return nil }
            return json["groupId"]?.stringValue
        }
        let text = message.parts.compactMap { part -> String? in
            guard case .text(let value) = part, TransferUpload(part) == nil else { return nil }
            return value.text
        }.joined(separator: "\n")
        guard !text.isEmpty || !uploads.isEmpty || !downloads.isEmpty else { return nil }
        let sentAt = metadata?["sentAt"]?.stringValue.flatMap(Self.parseDate) ?? message.createdAt
        let reply = metadata?["replyTo"]
        let replyTo = reply?["authorName"]?.stringValue.flatMap { name in
            reply?["text"]?.stringValue.map { ChannelReply(id: reply?["id"]?.stringValue, authorName: name, text: $0) }
        }
        self.init(id: message.id, senderId: senderId, isAgent: type == "agent", name: attributed.name,
                  avatar: attributed.avatar, runtime: sender["agentRuntime"]?.stringValue,
                  text: text, uploads: uploads, downloads: downloads, sentAt: sentAt, replyTo: replyTo)
    }

    /// What a reply to this post quotes until the chat stores its own snapshot.
    var asReply: ChannelReply {
        let words = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
        return ChannelReply(id: id, authorName: name, text: words.isEmpty ? String(localized: "File") : words)
    }

    func isMine(viewerId: String?) -> Bool { !isAgent && senderId == viewerId }

    private static func parseDate(_ raw: String) -> Date? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return iso.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
    }
}

/// What a chat's transcript shows, in the order it happened.
enum ChannelItem: Equatable, Sendable {
    /// `first` starts a run: it carries the avatar and the name.
    case post(ChannelPost, first: Bool)
    /// A centered time above a post that follows a pause.
    case time(Date)
    /// A line from the chat itself: its loop guard paused agents.
    case paused(String)
    /// An agent could not reply: why, and, on the newest line, the fix.
    case replyFailed(AgentConversationDetail.TimelineEvent, actionable: Bool)
    /// Agents in a turn right now.
    case typing([ChannelAgent])
    /// In a Bot's chat: a question the Bot or an agent under it waits on (#1848).
    case question(BotQuestion)
}

extension ChannelPost {
    /// The posts still on their way: the chat has not returned them yet.
    static func stillSending(stored: [ChannelPost], sending: [ChannelPost]) -> [ChannelPost] {
        let ids = Set(stored.map(\.id))
        return sending.filter { !ids.contains($0.id) }
    }

    /// Posts, the loop guard's lines and the typing bubble, as rows.
    static func items(posts: [ChannelPost], events: [AgentConversationDetail.TimelineEvent],
                      typing: [ChannelAgent]) -> [(id: String, item: ChannelItem)] {
        var rows: [(at: Date, id: String, item: ChannelItem)] = []
        var previous: Date?
        for (index, post) in posts.enumerated() {
            // A post on its way is the newest, whatever the clocks say. Its time
            // shows at once, so the chat returning it adds no row above it.
            let at = post.sending ? Date.distantFuture : post.sentAt ?? Date.distantPast
            let timed = ChatTime.showsTimestamp(post.sentAt, after: previous)
            if timed, let sentAt = post.sentAt { rows.append((at: at, id: "time.\(post.id)", item: ChannelItem.time(sentAt))) }
            previous = post.sentAt ?? previous
            let first = timed || index == 0 || posts[index - 1].senderId != post.senderId
            rows.append((at: at, id: "post.\(post.id)", item: ChannelItem.post(post, first: first)))
        }
        let lastPost = posts.compactMap(\.sentAt).max() ?? .distantPast
        for event in events {
            let id = "paused.\(event.at.timeIntervalSince1970)"
            if event.kind == "agents_paused" { rows.append((at: event.at, id: id, item: ChannelItem.paused(event.text))) }
            // Only the newest line offers the fix: anything after it moved past it.
            if event.kind == "agent_reply_failed" {
                let actionable = event == events.last && event.at >= lastPost
                rows.append((at: event.at, id: id, item: ChannelItem.replyFailed(event, actionable: actionable)))
            }
        }
        // Stable: posts keep their order where their times tie.
        var sorted: [(id: String, item: ChannelItem)] = rows.enumerated().sorted { a, b in
            a.element.at == b.element.at ? a.offset < b.offset : a.element.at < b.element.at
        }.map { (id: $0.element.id, item: $0.element.item) }
        if !typing.isEmpty { sorted.append((id: "typing", item: ChannelItem.typing(typing))) }
        return sorted
    }
}
