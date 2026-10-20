import Foundation

/// One row of `GET /agent/conversations` (`AgentConversation` in the
/// desktop's `api/agent-types.ts`). Fields the list and detail screens read;
/// the backend passes through more and we ignore it.
struct AgentConversation: Codable, Identifiable, Equatable, Hashable, Sendable {
    struct Owner: Codable, Equatable, Hashable, Sendable {
        let id: String
        let name: String?
        let email: String?
        let avatarURL: String?
        let deactivated: Bool?

        var displayName: String {
            if let name, !name.isEmpty { return name }
            if let email, !email.isEmpty { return email }
            return "User"
        }
    }

    struct TokenUsage: Codable, Equatable, Hashable, Sendable {
        let costUsd: Double?
    }

    struct ActivitySource: Codable, Equatable, Hashable, Sendable {
        let origin: String
        let linkedSlackThread: Bool?
    }

    /// A reply running right now, on any client.
    struct ActiveRun: Codable, Equatable, Hashable, Sendable {
        let streamId: String
        let startedAt: String?
    }

    let sessionId: String
    let teamId: String?
    let title: String
    let firstMessage: String
    let messageCount: Int
    let createdAt: Date
    /// Sort key and pagination cursor.
    let lastActiveAt: Date
    let archivedAt: Date?
    let owner: Owner?
    let isOwner: Bool?
    let readOnly: Bool?
    /// The owner, or a teammate invited to manage it: may switch the mode and
    /// the agent, and archive it.
    let canManage: Bool
    let tokenUsage: TokenUsage?
    let activitySource: ActivitySource?
    /// `nuphos` | `claude-code` | `codex` | `grok` | `antigravity` | `opencode`.
    let agentRuntime: String?
    let runtimeId: String?
    let runtimeLabel: String?
    let activeRun: ActiveRun?
    let runtimeState: JSONValue?
    /// Owner-only read state, shared by all of the owner's devices.
    let activitySeq: Int?
    let readSeq: Int?
    /// The conversation that opened this one as a thread; the Agent page
    /// nests it there. Cleared when the owner unlinks it.
    var parentSessionId: String?
    /// Whether this user gets the chat's push notifications. Nil from a
    /// backend that predates watching, which hides the toggle.
    var watching: Bool?

    var id: String { sessionId }

    var isNativeRuntime: Bool { agentRuntime != nil && agentRuntime != "nuphos" }

    /// `title || firstMessage || 'Untitled chat'` — titles are often empty on
    /// fresh conversations.
    var displayTitle: String {
        if !title.isEmpty { return title }
        if !firstMessage.isEmpty { return firstMessage }
        return "Untitled chat"
    }

    var isArchived: Bool { archivedAt != nil }
    var ownsChat: Bool { isOwner == true && readOnly != true }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = try c.decode(String.self, forKey: .sessionId)
        teamId = try c.decodeIfPresent(String.self, forKey: .teamId)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        firstMessage = try c.decodeIfPresent(String.self, forKey: .firstMessage) ?? ""
        messageCount = try c.decodeIfPresent(Int.self, forKey: .messageCount) ?? 0
        createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt) ?? .distantPast
        lastActiveAt = try c.decodeIfPresent(Date.self, forKey: .lastActiveAt) ?? createdAt
        archivedAt = try c.decodeIfPresent(Date.self, forKey: .archivedAt)
        owner = try c.decodeIfPresent(Owner.self, forKey: .owner)
        isOwner = try c.decodeIfPresent(Bool.self, forKey: .isOwner)
        readOnly = try c.decodeIfPresent(Bool.self, forKey: .readOnly)
        canManage = try c.decodeIfPresent(Bool.self, forKey: .canManage) ?? (isOwner == true && readOnly != true)
        tokenUsage = try c.decodeIfPresent(TokenUsage.self, forKey: .tokenUsage)
        activitySource = try c.decodeIfPresent(ActivitySource.self, forKey: .activitySource)
        agentRuntime = try c.decodeIfPresent(String.self, forKey: .agentRuntime)
        runtimeId = try c.decodeIfPresent(String.self, forKey: .runtimeId)
        runtimeLabel = try c.decodeIfPresent(String.self, forKey: .runtimeLabel)
        activeRun = try? c.decodeIfPresent(ActiveRun.self, forKey: .activeRun)
        runtimeState = try c.decodeIfPresent(JSONValue.self, forKey: .runtimeState)
        activitySeq = try? c.decodeIfPresent(Int.self, forKey: .activitySeq)
        readSeq = try? c.decodeIfPresent(Int.self, forKey: .readSeq)
        parentSessionId = try c.decodeIfPresent(String.self, forKey: .parentSessionId)
        watching = try? c.decodeIfPresent(Bool.self, forKey: .watching)
    }

    init(
        sessionId: String, teamId: String? = nil, title: String, firstMessage: String = "",
        messageCount: Int, createdAt: Date, lastActiveAt: Date, archivedAt: Date? = nil,
        owner: Owner? = nil, isOwner: Bool? = true, readOnly: Bool? = false,
        tokenUsage: TokenUsage? = nil, activitySource: ActivitySource? = nil,
        agentRuntime: String? = nil, runtimeId: String? = nil, runtimeLabel: String? = nil,
        activeRun: ActiveRun? = nil, runtimeState: JSONValue? = nil,
        activitySeq: Int? = nil, readSeq: Int? = nil, parentSessionId: String? = nil
    ) {
        self.sessionId = sessionId
        self.teamId = teamId
        self.title = title
        self.firstMessage = firstMessage
        self.messageCount = messageCount
        self.createdAt = createdAt
        self.lastActiveAt = lastActiveAt
        self.archivedAt = archivedAt
        self.owner = owner
        self.isOwner = isOwner
        self.readOnly = readOnly
        canManage = isOwner == true && readOnly != true
        self.tokenUsage = tokenUsage
        self.activitySource = activitySource
        self.agentRuntime = agentRuntime
        self.runtimeId = runtimeId
        self.runtimeLabel = runtimeLabel
        self.activeRun = activeRun
        self.runtimeState = runtimeState
        self.activitySeq = activitySeq
        self.readSeq = readSeq
        self.parentSessionId = parentSessionId
    }
}

/// A pull request or Linear issue the agent linked to a conversation
/// (`GET /agent/conversations/:id/resources`).
struct SessionResource: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    /// `github` | `linear`.
    let provider: String
    let title: String
    let url: URL
    let state: String
    let repository: String?
    let number: Int?

    /// What a chip has room for: `#165` for a pull request, or the identifier
    /// a Linear title starts with.
    var chip: String {
        if let number { return "#\(number)" }
        return title.split(separator: " ").first.map(String.init) ?? title
    }
}

extension Array where Element == AgentConversation {
    /// A fresh first page over the rows already listed: page one as the
    /// server returns it, then the later rows it no longer covers. Nothing a
    /// refresh misses is dropped, so a chat that leaves the list has to be
    /// removed by whoever took it out.
    func refreshed(firstPage: [AgentConversation]) -> [AgentConversation] {
        let ids = Set(firstPage.map(\.sessionId))
        return firstPage + filter { !ids.contains($0.sessionId) }
    }
}

struct AgentConversationsPage: Codable, Sendable {
    let conversations: [AgentConversation]
    /// The page's threads' parents that another page lists, so a thread nests
    /// under its parent before that page loads. Absent from older backends.
    var parents: [AgentConversation]? = nil
    let nextCursor: String?
    let hasMore: Bool

    /// What the list shows from this page: its rows, then their parents.
    var rows: [AgentConversation] {
        let ids = Set(conversations.map(\.sessionId))
        return conversations + (parents ?? []).filter { !ids.contains($0.sessionId) }
    }
}

/// `GET /agent/conversations/:id?tail=` — the transcript tail plus what a
/// client needs to attach to a reply still in flight.
struct AgentConversationDetail: Decodable, Sendable {
    struct ActiveRun: Decodable, Equatable, Sendable {
        let streamId: String
        let startedAt: String?
    }

    /// Who joined, left or moved the session, already phrased by the backend.
    struct TimelineEvent: Decodable, Equatable, Sendable {
        let at: Date
        let text: String
    }

    let messages: [ChatMessage]
    /// Absolute index of `messages[0]`; > 0 means older messages exist.
    let messagesFirstIndex: Int?
    let activeRun: ActiveRun?
    let runtimeState: JSONValue?
    let isOwner: Bool?
    let canManage: Bool?
    let readOnly: Bool?
    let title: String?
    /// The conversation's stored IAM choice (`AgentCredentialAccess`).
    let credentialAccess: JSONValue?
    let agentRuntime: String?
    let runtimeId: String?
    let runtimeLabel: String?
    let archivedAt: Date?
    let activitySeq: Int?
    let readSeq: Int?
    let watching: Bool?
    let timelineEvents: [TimelineEvent]

    private enum CodingKeys: String, CodingKey {
        case isOwner, canManage, messages, messagesFirstIndex, activeRun, runtimeState, readOnly, title, credentialAccess, agentRuntime, runtimeId, runtimeLabel, archivedAt, activitySeq, readSeq, watching, timelineEvents
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        messages = try c.decodeIfPresent([ChatMessage].self, forKey: .messages) ?? []
        messagesFirstIndex = try c.decodeIfPresent(Int.self, forKey: .messagesFirstIndex)
        activeRun = try? c.decodeIfPresent(ActiveRun.self, forKey: .activeRun)
        runtimeState = try c.decodeIfPresent(JSONValue.self, forKey: .runtimeState)
        isOwner = try c.decodeIfPresent(Bool.self, forKey: .isOwner)
        canManage = try c.decodeIfPresent(Bool.self, forKey: .canManage)
        readOnly = try c.decodeIfPresent(Bool.self, forKey: .readOnly)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        credentialAccess = try? c.decodeIfPresent(JSONValue.self, forKey: .credentialAccess)
        agentRuntime = try c.decodeIfPresent(String.self, forKey: .agentRuntime)
        runtimeId = try c.decodeIfPresent(String.self, forKey: .runtimeId)
        runtimeLabel = try c.decodeIfPresent(String.self, forKey: .runtimeLabel)
        archivedAt = try? c.decodeIfPresent(Date.self, forKey: .archivedAt)
        activitySeq = try? c.decodeIfPresent(Int.self, forKey: .activitySeq)
        readSeq = try? c.decodeIfPresent(Int.self, forKey: .readSeq)
        watching = try? c.decodeIfPresent(Bool.self, forKey: .watching)
        timelineEvents = (try? c.decodeIfPresent([TimelineEvent].self, forKey: .timelineEvents)) ?? []
    }
}
