import Foundation
import os

/// A member a chat's icon shows: a person, or an agent by its session
/// (`ChannelFace` in the desktop's `api/agent-types.ts`).
struct ChatFace: Codable, Equatable, Hashable, Sendable {
    struct Agent: Codable, Equatable, Hashable, Sendable {
        let avatar: String?
        let provider: String?
    }

    let id: String
    let name: String
    let avatarURL: String?
    let agent: Agent?
}

extension [ChatFace] {
    /// The Bot a chat with these faces is the 1:1 of: its one other member is an agent with a face.
    var botId: String? { count == 1 && self[0].agent?.avatar != nil ? self[0].id : nil }
}

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

    /// A chat's newest post, as its row previews it. `from` names the sender.
    struct LastMessage: Codable, Equatable, Hashable, Sendable {
        let text: String
        let from: String?
    }

    /// A `request_user_decision` still waiting on the owner. List rows carry
    /// only the open ones.
    struct InputRequest: Codable, Equatable, Hashable, Sendable {
        let id: String
        let category: String?
        let question: String
        let options: [String]?
        /// ISO time it was asked.
        let askedAt: String?
        /// Markdown the agent wrote to decide from: context, findings, links, risks.
        var body: String? = nil
        /// The plan an approval decides: answered with its Approve or Reject, never in words.
        var planId: String? = nil
        /// An integration question's providers (any access answers it), or the exact credentials it names.
        var providers: [String]? = nil
        var credentials: [CredentialRef]? = nil
        /// Any number of `options` may be picked.
        var multiSelect: Bool? = nil
        /// Related questions answered together; `question` is their headline.
        var questions: [DecisionQuestion]? = nil
    }

    /// One question of a card that asks several, with its own choices.
    struct DecisionQuestion: Codable, Equatable, Hashable, Sendable {
        let question: String
        var options: [String]? = nil
        var multiSelect: Bool? = nil
    }

    /// A credential an integration question names: `{provider: "personal", id: "github"}` is the member's own.
    struct CredentialRef: Codable, Equatable, Hashable, Sendable {
        let provider: String
        let id: String
    }

    let sessionId: String
    let teamId: String?
    let title: String
    let firstMessage: String
    let messageCount: Int
    let createdAt: Date
    /// Sort key and pagination cursor.
    let lastActiveAt: Date
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
    /// `channel` for a chat where people and agents talk; nil for an agent.
    var kind: String?
    /// A chat's icon: up to two members other than the viewer, whoever spoke last first.
    var faces: [ChatFace]?
    /// A Bot's face, e.g. `05-rembrandt`; nil for a Task (#1691).
    var avatar: String?
    /// Absent when the chat has no post yet, or from an older backend.
    var lastMessage: LastMessage?
    /// Open questions, oldest first; absent when there are none.
    var inputRequests: [InputRequest]?

    var id: String { sessionId }

    var isChannel: Bool { kind == "channel" }

    /// An agent with a face: a Bot, talked to in its 1:1 chat (#1691).
    var isBot: Bool { avatar != nil && !isChannel }

    /// The Bot this chat is the 1:1 of: its one other member is an agent with a face.
    var botId: String? { isChannel ? faces?.botId : nil }

    /// The list's preview line. Only a chat with more than one other member
    /// names who posted: in a 1:1 the row already is the sender.
    var previewLine: String? {
        guard let last = lastMessage else { return nil }
        guard let from = last.from, (faces?.count ?? 0) > 1 else { return last.text }
        return "\(from): \(last.text)"
    }

    /// The Bot of this 1:1 chat is in a turn that answers it: the chat's typing
    /// dots, which its list row shows in place of the newest post.
    func botTyping(in observations: RuntimeObservations, team: String) -> Bool {
        guard let botId else { return false }
        return observations.value(team: team, session: botId)?.typing(in: sessionId) == true
    }

    var isNativeRuntime: Bool { agentRuntime != nil && agentRuntime != "nuphos" }

    /// `title || firstMessage || 'Untitled chat'` — titles are often empty on
    /// fresh conversations.
    var displayTitle: String {
        if !title.isEmpty { return title }
        if !firstMessage.isEmpty { return firstMessage }
        return "Untitled agent"
    }

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
        kind = try? c.decodeIfPresent(String.self, forKey: .kind)
        faces = try? c.decodeIfPresent([ChatFace].self, forKey: .faces)
        avatar = try? c.decodeIfPresent(String.self, forKey: .avatar)
        lastMessage = try? c.decodeIfPresent(LastMessage.self, forKey: .lastMessage)
        inputRequests = try? c.decodeIfPresent([InputRequest].self, forKey: .inputRequests)
    }

    init(
        sessionId: String, teamId: String? = nil, title: String, firstMessage: String = "",
        messageCount: Int, createdAt: Date, lastActiveAt: Date,
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
    /// Linear's state type (`started`, `completed`, `canceled`, ...); absent for GitHub.
    var stateType: String? = nil
    let repository: String?
    let number: Int?

    /// What a chip has room for: `#165` for a pull request, or the identifier
    /// a Linear title starts with.
    var chip: String {
        if let number { return "#\(number)" }
        return title.split(separator: " ").first.map(String.init) ?? title
    }

    /// Merged or closed PRs and completed or canceled issues: worth knowing,
    /// no longer waiting on anyone.
    var isFinished: Bool {
        provider == "linear" ? stateType == "completed" || stateType == "canceled" : state == "merged" || state == "closed"
    }

    fileprivate var isMergedOrDone: Bool {
        provider == "linear" ? stateType == "completed" : state == "merged"
    }

    /// What the chip folding the finished links says, as on Desktop: `13 merged`
    /// (`2 done` when none is a PR), or `1 closed` when nothing merged.
    static func finishedLabel(_ finished: [SessionResource]) -> String {
        let merged = finished.filter(\.isMergedOrDone)
        if merged.isEmpty { return "\(finished.count) closed" }
        return "\(merged.count) \(merged.contains { $0.provider == "github" } ? "merged" : "done")"
    }
}

extension Array where Element == SessionResource {
    /// Open links first, in the order they were linked; finished ones after
    /// them, as on Desktop.
    var openFirst: (open: [SessionResource], finished: [SessionResource]) {
        (filter { !$0.isFinished }, filter(\.isFinished))
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

/// A transcript message, or nil when it does not decode: one bad message
/// is skipped instead of failing the whole conversation (#1150).
private struct LossyMessage: Decodable {
    let message: ChatMessage?

    init(from decoder: Decoder) {
        do {
            message = try ChatMessage(from: decoder)
        } catch {
            message = nil
            Logger(subsystem: "ai.nuphos.ios", category: "chat").error("hid undecodable message: \(String(describing: error), privacy: .public)")
        }
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
        /// `agents_paused` when a chat's loop guard stopped its agents.
        var kind: String? = nil
        /// `agent_reply_failed`: the agent that could not reply, for Retry and Switch agent.
        var agentId: String? = nil
        /// `agent_reply_failed`: `usage_limit`, `auth` or `offline` when the agent itself was the cause, else `other`.
        var cause: String? = nil
        /// `agent_reply_failed`: when an agent out of usage gets it back.
        var resetsAt: Date? = nil
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
    /// The runtime's guess at what the user will send next.
    let promptSuggestion: String?
    /// `channel` for a chat; nil for an agent.
    let kind: String?
    /// With `transcriptUpdatedAt`, what a chat's cheap probe compares to tell a new post.
    let messageCount: Int?
    let transcriptUpdatedAt: String?

    /// A chat's icon, as the list row carries it.
    let faces: [ChatFace]

    var isChannel: Bool { kind == "channel" }

    /// What an open chat shows, as its probe reports it: a change means a full read. Its name and
    /// faces count too: an untitled Bot chat is named after the Bot, so renaming the Bot changes them without a post.
    struct ChannelRevision: Equatable {
        let transcriptUpdatedAt: String?
        let messageCount: Int?
        let title: String?
        let faces: [ChatFace]
    }

    var channelRevision: ChannelRevision {
        ChannelRevision(transcriptUpdatedAt: transcriptUpdatedAt, messageCount: messageCount, title: title, faces: faces)
    }

    private enum CodingKeys: String, CodingKey {
        case faces, kind, messageCount, transcriptUpdatedAt, isOwner, canManage, messages, messagesFirstIndex, activeRun, runtimeState, readOnly, title, credentialAccess, agentRuntime, runtimeId, runtimeLabel, archivedAt, activitySeq, readSeq, watching, timelineEvents, promptSuggestion
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        messagesFirstIndex = try c.decodeIfPresent(Int.self, forKey: .messagesFirstIndex)
        // Positions in this list are positions on the server, so a message that
        // can't be decoded keeps its place as a hidden placeholder.
        let first = messagesFirstIndex ?? 0
        messages = (try c.decodeIfPresent([LossyMessage].self, forKey: .messages) ?? []).enumerated().map { index, entry in
            entry.message ?? .unreadable(at: first + index)
        }
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
        promptSuggestion = try? c.decodeIfPresent(String.self, forKey: .promptSuggestion)
        kind = try? c.decodeIfPresent(String.self, forKey: .kind)
        messageCount = try? c.decodeIfPresent(Int.self, forKey: .messageCount)
        faces = (try? c.decodeIfPresent([ChatFace].self, forKey: .faces)) ?? []
        transcriptUpdatedAt = try? c.decodeIfPresent(String.self, forKey: .transcriptUpdatedAt)
    }
}
