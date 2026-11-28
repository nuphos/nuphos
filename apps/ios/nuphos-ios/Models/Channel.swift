import Foundation

/// An agent brought into a chat (`GET /agent/conversations/:id/agents`).
struct ChannelAgent: Decodable, Equatable, Identifiable, Sendable {
    let sessionId: String
    let title: String
    let ownerId: String
    var provider: String? = nil
    /// Its face, which every member of the chat reads, whoever owns the Bot.
    var avatar: String? = nil
    /// The tint its face sits on; nil for none.
    var avatarBackground: String? = nil
    /// Whether it can reply now, as the server works it out; nil from a server without it.
    var presence: BotPresence? = nil
    var id: String { sessionId }
}

/// Whether a Bot can reply now (`presence`), read as Desktop and Android read it.
struct BotPresence: Codable, Hashable, Sendable {
    let state: String
    var reason: String? = nil
    var resetsAt: String? = nil

    enum Tone { case ready, waiting, down }

    /// Its dot's tone and the word beside it.
    var tag: (tone: Tone, word: String) {
        switch (state, reason) {
        case ("online", _): (.ready, String(localized: "Online"))
        case ("busy", _): (.ready, String(localized: "Busy"))
        case (_, "computer_offline"): (.down, String(localized: "Offline"))
        case (_, "sign_in_required"): (.waiting, String(localized: "Needs sign-in"))
        case (_, "usage_limit"): (.waiting, String(localized: "Out of usage"))
        default: (.down, String(localized: "Unavailable"))
        }
    }

    /// The line above the composer while an agent's computer is away: a Bot's own
    /// chat says it as its Task does; a group chat names the agent.
    static func offlineStrip(_ agents: [ChannelAgent], botId: String?) -> String? {
        guard let away = agents.first(where: { $0.presence?.state == "offline" && $0.presence?.reason == "computer_offline" })
        else { return nil }
        return away.sessionId == botId
            ? String(localized: "The computer running this runtime is offline. Open Nuphos on it, or switch to another runtime.")
            : String(localized: "\(away.title)’s computer is offline.")
    }
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
    /// The record an answer to an agent's question leaves here: a line from Nuphos, not a post.
    var isRecord = false
    /// The question card this post answers, when its answer was given in the Inbox (#3548).
    var inboxRequest: String?

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
    /// by a person or an agent: a chat shows only their posts, and the records
    /// Nuphos leaves (answers to questions, a new owner).
    init?(_ message: ChatMessage) {
        let metadata = message.metadata
        guard let sender = metadata?["sender"], let type = sender["type"]?.stringValue,
              type == "user" || type == "agent" || sender["id"]?.stringValue.map(Self.records.contains) == true,
              let senderId = metadata?["sourceSessionId"]?.stringValue ?? sender["id"]?.stringValue else { return nil }
        let attributed = message.sender
        guard attributed != nil || type == "system" else { return nil }
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
        self.init(id: message.id, senderId: senderId, isAgent: type == "agent", name: attributed?.name ?? "Nuphos",
                  avatar: attributed?.avatar, runtime: sender["agentRuntime"]?.stringValue,
                  text: text, uploads: uploads, downloads: downloads, sentAt: sentAt, replyTo: replyTo)
        isRecord = type == "system"
        inboxRequest = metadata?["answeredIn"]?.stringValue == "inbox" ? metadata?["requestId"]?.stringValue : nil
    }

    /// The senders of the records Nuphos leaves in a chat: an answer to a
    /// question, and a change of owner when the owner leaves.
    static let records: Set<String> = ["nuphos:decision", "nuphos:chat"]

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
    /// "Yuanlin answered: Question → answer": the record an answer to a question left before answers were posts.
    case record(String)
    /// "Answered in Inbox", under the last answer of a question card.
    case answeredInInbox(ChannelPost)
    /// An agent could not reply: why, and, on the newest line, the fix.
    case replyFailed(AgentConversationDetail.TimelineEvent, actionable: Bool)
    /// Agents in a turn right now.
    case typing([ChannelAgent])
    /// In a Bot's chat: a question the Bot or an agent under it waits on (#1848).
    case question(BotQuestion)
    /// In a Bot's chat: an artifact or chart the Bot made in its own conversation, for a viewer who may open it.
    case card(ToolCard)
}

extension ChannelPost {
    /// The posts still on their way: the chat has not returned them yet.
    static func stillSending(stored: [ChannelPost], sending: [ChannelPost]) -> [ChannelPost] {
        let ids = Set(stored.map(\.id))
        return sending.filter { !ids.contains($0.id) }
    }

    /// Posts, the loop guard's lines and the typing bubble, as rows.
    static func items(posts: [ChannelPost], events: [AgentConversationDetail.TimelineEvent],
                      typing: [ChannelAgent], questions: [BotQuestion] = [],
                      cards: [(at: Date, card: ToolCard)] = []) -> [(id: String, item: ChannelItem)] {
        var rows: [(at: Date, id: String, item: ChannelItem)] = []
        var previous: Date?
        for (index, post) in posts.enumerated() {
            // A post on its way is the newest, whatever the clocks say. Its time
            // shows at once, so the chat returning it adds no row above it.
            let at = post.sending ? Date.distantFuture : post.sentAt ?? Date.distantPast
            let timed = ChatTime.showsTimestamp(post.sentAt, after: previous)
            if timed, let sentAt = post.sentAt { rows.append((at: at, id: "time.\(post.id)", item: ChannelItem.time(sentAt))) }
            previous = post.sentAt ?? previous
            if post.isRecord {
                rows.append((at: at, id: "record.\(post.id)", item: ChannelItem.record(post.text)))
                continue
            }
            let first = timed || index == 0 || posts[index - 1].senderId != post.senderId
            rows.append((at: at, id: "post.\(post.id)", item: ChannelItem.post(post, first: first)))
            if let request = post.inboxRequest, index == posts.count - 1 || posts[index + 1].inboxRequest != request {
                rows.append((at: at, id: "answered.\(post.id)", item: ChannelItem.answeredInInbox(post)))
            }
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
        // A question sits where it was asked, as on the desktop.
        for question in questions {
            let at = question.request.askedAt.flatMap(parseDate) ?? .distantPast
            rows.append((at: at, id: "question.\(question.id)", item: ChannelItem.question(question)))
        }
        for (at, card) in cards { rows.append((at: at, id: "card.\(card.id)", item: ChannelItem.card(card))) }
        // Stable: posts keep their order where their times tie.
        var sorted: [(id: String, item: ChannelItem)] = rows.enumerated().sorted { a, b in
            a.element.at == b.element.at ? a.offset < b.offset : a.element.at < b.element.at
        }.map { (id: $0.element.id, item: $0.element.item) }
        if !typing.isEmpty { sorted.append((id: "typing", item: ChannelItem.typing(typing))) }
        return sorted
    }
}

/// What leaving a group chat does, as the server decides it: the owner's chat
/// passes to whoever joined first, and the last one out archives it.
enum ChannelLeave: Equatable {
    case archives, handsOver(to: String), leaves

    /// `people` in the server's order: the owner, then by when each joined.
    init(people: [(id: String, name: String, isOwner: Bool)], viewerId: String?) {
        if people.count <= 1 { self = .archives }
        else if people.first(where: \.isOwner)?.id == viewerId, let next = people.first(where: { !$0.isOwner }) { self = .handsOver(to: next.name) }
        else { self = .leaves }
    }
}

extension [AgentConversation] {
    /// The viewer's own Bots not in the chat yet: only a Bot's owner may add it.
    func addable(to agents: [ChannelAgent]) -> [AgentConversation] {
        let here = Set(agents.map(\.sessionId))
        return filter { $0.isBot && !here.contains($0.sessionId) }
    }
}
