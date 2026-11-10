import Foundation
import Observation

/// A chat: people and agents talking. It runs no agent of its own; each agent
/// here answers from its own session. Polled while it is the open chat, as the
/// desktop's `useChannel` is: a cheap probe, and the full read only when it changed.
@Observable
final class ChannelSession {
    static let pollInterval: Duration = .seconds(4)
    private static let tail = 200

    let channelId: String
    let teamId: String
    private(set) var title: String
    /// The chat's icon: the members other than the viewer that it shows.
    var faces: [ChatFace] = []
    private(set) var stored: [ChannelPost] = []
    private(set) var events: [AgentConversationDetail.TimelineEvent] = []
    private(set) var agents: [ChannelAgent] = []
    private(set) var loaded = false
    private(set) var loadError: String?
    private(set) var readOnly = false
    /// Posts shown at once, until the chat returns them under the same id.
    private(set) var sending: [ChannelPost] = []
    /// What a sending post attached, drawn from the device until it is posted.
    private(set) var sendingAttachments: [String: [ComposerAttachment]] = [:]
    /// Each posted file group's files, read before its post shows, so a post
    /// is measured once at its final height.
    private(set) var files: [String: [TransferDownloadGroup.File]] = [:]
    /// The latest send, so the transcript returns to the end for it.
    private(set) var lastSubmittedRowID: String?
    /// A post that could not be sent goes back into the composer.
    var unsent: ComposerSubmission?
    /// The post the next one answers, quoted above the composer.
    var replying: ChannelReply?
    var sendError: String?
    /// In a Bot's chat: the open questions of the Bot and of every agent under it.
    let questions: OpenQuestions
    /// The signed-in person: whose posts sit on the right.
    var viewerId: String?
    var me: ChatMessage.Sender?

    private let token: String
    private var revision: AgentConversationDetail.ChannelRevision?
    /// A resend of the same post reuses its id, so a post that did land is not doubled.
    private var retry: (key: String, id: String)?

    init(token: String, teamId: String, channelId: String, title: String) {
        self.token = token
        self.teamId = teamId
        self.channelId = channelId
        self.title = title
        questions = OpenQuestions(token: token, teamId: teamId)
    }

    var posts: [ChannelPost] { stored + ChannelPost.stillSending(stored: stored, sending: sending) }

    // MARK: - Reading

    /// Reads the chat until cancelled. `AgentStore.poll` runs it while this is the open chat.
    func poll() async {
        while !Task.isCancelled {
            await refresh()
            await refreshQuestions()
            try? await Task.sleep(for: Self.pollInterval)
        }
    }

    /// The probe, then the full read when the chat changed; `force` skips the probe.
    func refresh(force: Bool = false) async {
        do {
            if !force, loaded {
                // The probe reads the newest post, so an open chat is read up to it: a
                // post's activity can land after the transcript change the probe compares.
                let probe = try await NuphosAPI.conversationDetail(token: token, teamId: teamId, sessionId: channelId, tail: 1)
                guard probe.channelRevision != revision else { return }
            }
            async let detail = NuphosAPI.conversationDetail(token: token, teamId: teamId, sessionId: channelId, tail: Self.tail)
            async let listed = Self.listAgents(token: token, teamId: teamId, channelId: channelId)
            let (read, people) = try await (detail, listed)
            await resolveFiles(of: read.messages.compactMap(ChannelPost.init))
            apply(read, agents: people)
        } catch {
            if !loaded { loadError = error.localizedDescription; loaded = true }
        }
    }

    private func apply(_ detail: AgentConversationDetail, agents listed: [ChannelAgent]) {
        stored = detail.messages.compactMap(ChannelPost.init)
        sending = ChannelPost.stillSending(stored: stored, sending: sending)
        sendingAttachments = sendingAttachments.filter { id, _ in sending.contains { $0.id == id } }
        events = detail.timelineEvents
        agents = listed
        readOnly = detail.readOnly ?? false
        if let title = detail.title, !title.isEmpty { self.title = title }
        faces = detail.faces
        revision = detail.channelRevision
        loadError = nil
        loaded = true
    }

    private func resolveFiles(of posts: [ChannelPost]) async {
        let missing = Set(posts.flatMap { $0.uploads.map(\.groupId) + $0.downloads }).subtracting(files.keys)
        await withTaskGroup(of: (String, [TransferDownloadGroup.File]?).self) { group in
            for id in missing {
                group.addTask { [self] in (id, (try? await transferGroup(id))?.readyFiles) }
            }
            // A failed read stays out, so the next refresh, or the card itself, tries again.
            for await (id, ready) in group { if let ready { files[id] = ready } }
        }
    }

    /// A file posted here, with fresh links, for anyone who can read the chat.
    func transferGroup(_ groupId: String) async throws -> TransferDownloadGroup {
        try await WorkspaceAPI.request("agent/conversations/\(channelId)/attachments/\(groupId)",
                                       query: [URLQueryItem(name: "teamId", value: teamId)], token: token)
    }

    private static func listAgents(token: String, teamId: String, channelId: String) async throws -> [ChannelAgent] {
        struct Envelope: Decodable { let agents: [ChannelAgent] }
        let envelope: Envelope = try await WorkspaceAPI.request(
            "agent/conversations/\(channelId)/agents", query: [URLQueryItem(name: "teamId", value: teamId)], token: token)
        return envelope.agents
    }

    // MARK: - Questions

    /// A Bot's chat reads the pending listing, as the desktop's does; any other chat has none.
    func refreshQuestions() async {
        guard let bot = faces.botId else { return }
        await questions.refresh { BotQuestions.under(bot: bot, rows: $0) }
    }

    /// The Bot's own question is answered by a post here, shown at once as any
    /// post is, so the answer is the viewer's message in this chat. An agent
    /// under the Bot takes it in its own conversation.
    func answer(_ question: BotQuestion, with text: String) {
        guard question.sessionId == faces.botId else {
            Task { await questions.answer(question, with: text) }
            return
        }
        let id = UUID().uuidString.lowercased()
        sending.append(ChannelPost(
            id: id, senderId: viewerId ?? "", isAgent: false, name: me?.name ?? "You", avatar: me?.avatar,
            text: text, sentAt: .now, replyTo: nil, sending: true))
        lastSubmittedRowID = "post.\(id)"
        Task {
            await questions.answer(question, with: text) { [self] in
                do {
                    try await Self.postAnswer(token: token, teamId: teamId, channelId: channelId, text: text,
                                              id: id, to: question.request.id)
                } catch {
                    sending.removeAll { $0.id == id }
                    throw error
                }
                await refresh(force: true)
            }
        }
    }

    /// A post in a Bot's chat naming the Bot's question it answers.
    static func postAnswer(token: String, teamId: String, channelId: String, text: String, id: String,
                           to requestId: String) async throws {
        let body: [String: JSONValue] = [
            "text": .string(text), "id": .string(id), "decisionReplyTo": .string(requestId)]
        _ = try await AgentChatAPI.send(
            "POST", "agent/conversations/\(channelId)/channel-messages",
            query: [URLQueryItem(name: "teamId", value: teamId)], token: token, body: JSONValue.object(body))
    }

    // MARK: - Posting

    /// Shown at once; files upload first, then the post goes out with their group.
    func send(_ submission: ComposerSubmission) {
        let text = submission.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty || !submission.attachments.isEmpty else { return }
        let reply = replying
        replying = nil
        let key = ([reply?.id ?? "", text] + submission.attachments.map(\.name)).joined(separator: "\n")
        let id = retry?.key == key ? retry!.id : UUID().uuidString.lowercased()
        retry = (key, id)
        sending.append(ChannelPost(
            id: id, senderId: viewerId ?? "", isAgent: false, name: me?.name ?? "You", avatar: me?.avatar,
            text: text, sentAt: .now, replyTo: reply, sending: true))
        if !submission.attachments.isEmpty { sendingAttachments[id] = submission.attachments }
        lastSubmittedRowID = "post.\(id)"
        Task {
            do {
                var body: [String: JSONValue] = ["text": .string(text), "id": .string(id)]
                if let replyId = reply?.id { body["replyTo"] = .string(replyId) }
                if !submission.attachments.isEmpty {
                    let upload = try await WorkspaceAPI.upload(
                        token: token, team: teamId, attachments: submission.attachments, progress: Progress())
                    body["upload"] = .string(upload.groupId)
                }
                _ = try await AgentChatAPI.send(
                    "POST", "agent/conversations/\(channelId)/channel-messages",
                    query: [URLQueryItem(name: "teamId", value: teamId)], token: token, body: JSONValue.object(body))
                retry = nil
                await refresh(force: true)
            } catch {
                sending.removeAll { $0.id == id }
                sendingAttachments[id] = nil
                sendError = error.localizedDescription
                unsent = submission
                replying = reply
            }
        }
    }

    /// Retry after an agent could not reply: it reads again what it has not read yet.
    func wake(agent agentId: String) {
        Task {
            do {
                _ = try await AgentChatAPI.send(
                    "POST", "agent/conversations/\(channelId)/agents/\(agentId)/wake",
                    query: [URLQueryItem(name: "teamId", value: teamId)], token: token, body: JSONValue?.none)
                await refresh(force: true)
            } catch {
                sendError = error.localizedDescription
            }
        }
    }
}
