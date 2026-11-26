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
    /// The Bot this is the 1:1 chat of; nil in a group chat, even one with only a Bot in it.
    var botId: String?
    /// When the chat was made, as its last read says; nil until then.
    var createdAt: Date?
    private(set) var stored: [ChannelPost] = []
    private(set) var events: [AgentConversationDetail.TimelineEvent] = []
    private(set) var agents: [ChannelAgent] = []
    private(set) var loaded = false
    private(set) var loadError: String?
    private(set) var readOnly = false
    /// Posts shown at once, until the chat returns them under the same id.
    private(set) var sending: [ChannelPost] = []
    /// What a sending post attached, drawn from the device until it is posted,
    /// and how far it has uploaded.
    private(set) var sendingUploads: [String: SendingUpload] = [:]
    struct SendingUpload {
        let attachments: [ComposerAttachment]
        let progress = Progress()
    }
    /// Each posted file group's files, read once its post shows, so the chat
    /// shows without waiting on them; a card drawn before then reads its own (#3525).
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
        // The chat opens on its last read, as a messaging app does; `refresh` reads it again.
        if let detail = NuphosAPI.cachedConversationDetail(token: token, sessionId: channelId) {
            let agents = LaunchCache.chat(Self.agentsName(channelId), token: token)
                .flatMap { try? JSONDecoder().decode(AgentsEnvelope.self, from: $0).agents }
            apply(detail, agents: agents ?? [])
        }
    }

    var posts: [ChannelPost] { stored + ChannelPost.stillSending(stored: stored, sending: sending) }

    // MARK: - Reading

    /// Why the open chat is read again: the poll's tick, a change the server pushed, or its
    /// change stream coming up (it may have missed some while down) or going down.
    private enum Wake { case tick, changed, up, down }

    /// Reads the chat until cancelled. `AgentStore.poll` runs it while this is the open chat.
    /// The server pushes which conversations changed (#3906), so the chat is read the moment it
    /// does and polls only while that stream is down. Its questions are polled either way.
    func poll() async {
        let (wakes, wake) = AsyncStream.makeStream(of: Wake.self)
        let ticker = Task {
            while !Task.isCancelled {
                wake.yield(.tick)
                try? await Task.sleep(for: Self.pollInterval)
            }
        }
        let changes = Task { await followChanges(wake) }
        defer {
            ticker.cancel()
            changes.cancel()
        }
        var pushed = false
        // One read at a time, so an older read never lands over a newer one.
        for await reason in wakes {
            switch reason {
            case .up:
                pushed = true
                await refresh(force: true)
            case .down: pushed = false
            case .changed:
                changePending = false
                await refresh(force: true)
            case .tick:
                if !pushed { await refresh() }
                await refreshQuestions()
            }
        }
    }

    /// A pushed change waits to be read: more changes before that read need no read of their own.
    private var changePending = false

    /// Follows the team's changes, waking the chat for its own, and reconnects with backoff.
    private func followChanges(_ wake: AsyncStream<Wake>.Continuation) async {
        var failures = 0
        while !Task.isCancelled {
            var request = URLRequest(url: NuphosAPI.baseURL(for: token).appending(path: "teams/\(teamId)/agent-changes"))
            request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
            request.setValue("text/event-stream", forHTTPHeaderField: "accept")
            request.setValue("identity", forHTTPHeaderField: "accept-encoding")
            request.setValue(AgentChatAPI.clientVersion, forHTTPHeaderField: "x-atlas-client")
            request.timeoutInterval = 60
            let started = ContinuousClock.now
            do {
                // Three missed 5 s heartbeats is a dead stream.
                for try await event in SSEClient.events(for: request, idleTimeout: .seconds(15), onOpen: { wake.yield(.up) })
                where !changePending && JSONValue.parse(event.data)?["sessionId"]?.stringValue == channelId {
                    changePending = true
                    wake.yield(.changed)
                }
            } catch SSEClient.Failure.badStatus(404, _) {
                // A backend from before the push has no such route: the chat keeps polling.
                return
            } catch {}
            wake.yield(.down)
            failures = ContinuousClock.now - started > .seconds(30) ? 1 : failures + 1
            try? await Task.sleep(for: .milliseconds(min(30_000, 500 << min(failures, 6))))
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
            apply(read, agents: people)
            await resolveFiles(of: stored)
        } catch {
            // Cancelled (the chat closed, the app left the foreground): not a
            // failure, and not loaded, so the next poll reads it (#3620).
            if !loaded, !Task.isCancelled { loadError = error.localizedDescription; loaded = true }
        }
    }

    private func apply(_ detail: AgentConversationDetail, agents listed: [ChannelAgent]) {
        stored = detail.messages.compactMap(ChannelPost.init)
        sending = ChannelPost.stillSending(stored: stored, sending: sending)
        sendingUploads = sendingUploads.filter { id, _ in sending.contains { $0.id == id } }
        events = detail.timelineEvents
        agents = listed
        // A teammate's Bot is in none of this viewer's lists: its face comes from the chat.
        for agent in listed { BotFaces.shared.learn(agent.sessionId, avatar: agent.avatar, background: agent.avatarBackground) }
        readOnly = detail.readOnly ?? false
        if let title = detail.title, !title.isEmpty { self.title = title }
        faces = detail.faces
        botId = detail.botId
        createdAt = detail.createdAt
        revision = detail.channelRevision
        loadError = nil
        loaded = true
    }

    private func resolveFiles(of posts: [ChannelPost]) async {
        let missing = Set(posts.flatMap { $0.uploads.map(\.groupId) + $0.downloads }).subtracting(files.keys)
        await withTaskGroup(of: (String, [TransferDownloadGroup.File]?).self) { group in
            for id in missing {
                group.addTask { [self] in
                    do { return (id, try await transferGroup(id).readyFiles) }
                    // Gone for good (expired, or purged at its expiry): no files, so the
                    // card shows it expired and no refresh reads it again.
                    catch AgentChatAPI.Conflict.other(_, _, let status) where status == 404 || status == 410 { return (id, []) }
                    catch { return (id, nil) }
                }
            }
            // Any other failed read stays out, so the next refresh, or the card itself, tries again.
            for await (id, ready) in group { if let ready { files[id] = ready } }
        }
    }

    /// A file posted here, with fresh links, for anyone who can read the chat.
    func transferGroup(_ groupId: String) async throws -> TransferDownloadGroup {
        try await WorkspaceAPI.request("agent/conversations/\(channelId)/attachments/\(groupId)",
                                       query: [URLQueryItem(name: "teamId", value: teamId)], token: token)
    }

    private struct AgentsEnvelope: Decodable { let agents: [ChannelAgent] }
    private static func agentsName(_ channelId: String) -> String { "\(channelId).agents" }

    private static func listAgents(token: String, teamId: String, channelId: String) async throws -> [ChannelAgent] {
        let data = try await AgentChatAPI.send(
            "GET", "agent/conversations/\(channelId)/agents", query: [URLQueryItem(name: "teamId", value: teamId)], token: token,
            body: JSONValue?.none, timeout: 60)
        let agents = try JSONDecoder().decode(AgentsEnvelope.self, from: data).agents
        LaunchCache.storeChat(data, as: agentsName(channelId), token: token)
        return agents
    }

    // MARK: - Questions

    /// A Bot's chat reads the pending listing, as the desktop's does; any other chat has none.
    func refreshQuestions() async {
        guard let bot = botId else { return }
        await questions.refresh { BotQuestions.under(bot: bot, rows: $0) }
    }

    /// Answers a question in this chat: the server wakes the agent that asked, which replies
    /// where it asked; no message is sent.
    func answer(_ question: BotQuestion, with answer: DecisionAnswer) {
        Task { await questions.answer(question, with: answer) }
    }

    /// Dismisses a question unanswered, as the desktop's Dismiss does: the agent that asked is told.
    func dismiss(_ question: BotQuestion) {
        Task { await questions.dismiss(question) }
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
        let upload = submission.attachments.isEmpty ? nil : SendingUpload(attachments: submission.attachments)
        sendingUploads[id] = upload
        lastSubmittedRowID = "post.\(id)"
        Task {
            do {
                var body: [String: JSONValue] = ["text": .string(text), "id": .string(id)]
                if let replyId = reply?.id { body["replyTo"] = .string(replyId) }
                if let upload {
                    let group = try await WorkspaceAPI.upload(
                        token: token, team: teamId, attachments: upload.attachments, progress: upload.progress)
                    body["upload"] = .string(group.groupId)
                }
                _ = try await AgentChatAPI.send(
                    "POST", "agent/conversations/\(channelId)/channel-messages",
                    query: [URLQueryItem(name: "teamId", value: teamId)], token: token, body: JSONValue.object(body))
                retry = nil
                await refresh(force: true)
            } catch {
                sending.removeAll { $0.id == id }
                sendingUploads[id] = nil
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
