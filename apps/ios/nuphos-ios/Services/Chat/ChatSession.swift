import Foundation
import Observation
import SwiftUI
import os

/// One conversation's live state: the transcript, the reply being streamed,
/// approvals waiting on the user, queued messages, and the sync back to the
/// server. Mirrors the desktop's panel + main-process chat loop.
@Observable
final class ChatSession {
    // MARK: - Public state

    let sessionId: String
    let teamId: String
    private(set) var title: String
    private(set) var messages: [ChatMessage] = []
    /// A local send is an explicit navigation intent; server refreshes are not.
    private(set) var lastSubmittedRowID: String?
    /// Absolute transcript index of `messages[0]` (tail window).
    private(set) var baseIndex: Int = 0
    private(set) var transportStreaming = false
    /// Status line under the reply while nothing renderable has arrived.
    private(set) var phaseLabel: String?
    private(set) var error: String?
    private(set) var queued: [String] = []
    private(set) var isOwner = false
    private var canCancelRun = false
    private var canRespondToRun = false
    var canManage: Bool { loaded && isOwner && !readOnly }
    private(set) var readOnly = false
    private(set) var loaded = false
    private(set) var loadError: String?
    /// The user asked for the stream to stop; suppresses error copy.
    private(set) var stoppedByUser = false
    /// Stop was sent; the runtime has not yet closed the turn.
    private(set) var isStopping = false
    /// When the current reply started — for "Worked for Xs".
    private(set) var turnStartedAt: Date?
    /// New conversation: sent on the first POST. Existing: mirrors the
    /// server's bypass flag — change it with `setPermissionMode`.
    private(set) var permissionMode: PermissionMode = .auto
    /// Sent with each turn; nil keeps the conversation's stored choice.
    var credentialAccess: CredentialSelection?
    /// Sent as soon as `load()` finishes on a writable, idle conversation —
    /// how the Plans page tells the agent to proceed with an approved plan.
    var sendAfterLoad: String?
    /// New conversation: the runtime it starts on (nil lets the team default
    /// decide). Sent on the first PUT/POST only.
    var runtime: RuntimeInstance?
    /// Existing conversation: `nuphos` | `claude-code` | `codex` | `grok` | `antigravity`.
    private(set) var agentRuntime: String?
    private(set) var runtimeLabel: String?
    /// Invites, removals and runtime moves, refreshed with every detail read.
    private(set) var timelineEvents: [AgentConversationDetail.TimelineEvent] = []
    /// Files the agent sent the user here, read from the transfer store.
    private(set) var downloads: [TransferDownloadGroup] = []
    private(set) var isArchived = false
    /// Model / effort / fast controls, for conversations on a native runtime.
    private(set) var sessionConfig: SessionConfigState?
    private(set) var sessionConfigError: String?
    private(set) var sessionConfigSaving = false
    private(set) var pendingModelSettings: [String: String] = [:]
    private var sessionConfigRequest = UUID()
    private var sessionConfigReading = false

    private(set) var initialModelTitle: String?
    /// Settings picked before this conversation existed; the first message carries them.
    private var initialSessionConfig: [String: String]?
    func presetSessionConfig(_ config: SessionConfigState?, pick: [String: String]) {
        initialModelTitle = config?.modelTitle
        initialSessionConfig = pick.isEmpty ? nil : pick
    }

    /// Conversations on Claude Code / Codex, where the runtime holds the
    /// transcript and can take a message mid-turn.
    var isNativeRuntime: Bool {
        if let agentRuntime { return agentRuntime != "nuphos" }
        return runtime != nil
    }

    var runtimeDisplayName: String? {
        runtimeLabel ?? runtime?.label ?? agentRuntime.map { RuntimeInstance.Provider.name($0) }
    }

    private let observations = RuntimeObservations.shared
    var runtimeObservation: RuntimeObservation? { observations.value(team: teamId, session: sessionId) }
    var isStreaming: Bool { isNativeRuntime ? runtimeObservation?.executing(at: observations.now) == true : transportStreaming }
    var runtimeStatus: String? {
        if submitting || awaitingAdmission { return "Sending…" }
        guard isNativeRuntime, !isNew else { return nil }
        guard let runtimeObservation else { return "Connection lost — runtime status unavailable" }
        return runtimeObservation.status(at: observations.now)
    }
    /// What the user just sent, shown as their bubble until the request is
    /// admitted; it goes back to the composer if the upload fails or is cancelled.
    struct Sending {
        let submission: ComposerSubmission
        let progress = Progress()
        fileprivate var task: Task<Void, Never>?
    }
    private(set) var sending: Sending?
    var submitting: Bool { sending != nil }
    func cancelSending() { sending?.task?.cancel() }
    private(set) var steeringPending = false
    /// Prevent double submission until this request has a runtime admission or terminal response.
    private var awaitingAdmission = false
    var canSteer: Bool { canRespondToRun && !readOnly && isNativeRuntime && allows("steer") && !allows("reply") && !steeringPending }
    var canReply: Bool { !readOnly && (!isNativeRuntime || (canRespondToRun && allows("reply"))) }
    var canCancel: Bool { (isOwner || canCancelRun) && !readOnly && !isStopping && (isNativeRuntime ? allows("cancel") : transportStreaming) }
    var canSubmit: Bool { loaded && loadError == nil && !readOnly && failedSubmission == nil && !submitting && !awaitingAdmission && !steeringPending && (!isNativeRuntime || isNew || allows("send") || canReply || canSteer) }
    private func allows(_ action: String) -> Bool { runtimeObservation?.allows(action, at: observations.now) == true }
    private func receiveRuntime(_ snapshot: JSONValue?, observedAt: TimeInterval) {
        observations.receive(snapshot, team: teamId, session: sessionId, observedAt: observedAt)
        if runtimeObservation?.executing(at: observations.now) == true { awaitingAdmission = false }
    }
    func tickRuntimeClock() { observations.tick() }


    /// Changes the mode; for a conversation the server knows, that is a
    /// `PUT /agent/auto-mode/bypass` (the mode on the first POST is final).
    func setPermissionMode(_ mode: PermissionMode) {
        guard canManage else { return }
        let previous = permissionMode
        permissionMode = mode
        guard !isNew, previous != mode else { return }
        Task {
            do {
                try await AgentChatAPI.setBypass(token: token, sessionId: sessionId, bypass: mode == .bypass)
            } catch {
                permissionMode = previous
                self.error = error.localizedDescription
            }
        }
    }

    /// Initial mode for a new conversation (no server call).
    func presetPermissionMode(_ mode: PermissionMode) { permissionMode = mode }

    var isNew: Bool { messages.isEmpty && loaded }

    /// Re-reads the files the agent sent. The list is owner-only, as on the desktop.
    func refreshDownloads() async {
        guard isOwner, messages.contains(where: { $0.role == .assistant }) else { return }
        struct List: Decodable { let groups: [TransferDownloadGroup] }
        guard let list: List = try? await WorkspaceAPI.request(transferPath + "/downloads", token: token) else { return }
        downloads = list.groups.filter { $0.expiresAt > .now && !$0.readyFiles.isEmpty }
    }

    /// A transfer group's files with fresh presigned URLs. Team-scoped, so it
    /// resolves both what the agent sent and what the user uploaded.
    func transferGroup(_ groupId: String) async throws -> TransferDownloadGroup {
        try await WorkspaceAPI.request("teams/\(teamId)/file-transfers/\(groupId)/download", token: token)
    }

    private var transferPath: String { "agent-sessions/\(sessionId)/teams/\(teamId)/file-transfers" }

    // MARK: - Private

    private let token: String
    private var streamTask: Task<Void, Never>?
    private var currentStreamId: String?
    private var transcriptSyncTask: Task<Void, Never>?
    private var lastSyncedSignature = 0
    private var autoResumeAttempts = 0
    private var transcriptFullResend = false
    private var transcriptRebasedTo: Int?
    /// Where the reply being streamed sits, and the reducer writing it. They
    /// belong to the one stream a session runs at a time, so the scheduled
    /// flush can reach them between frames.
    private var streamAssistantIndex: Int?
    private var streamReducer: UIStreamReducer?
    private var backlog = StreamBacklog()
    private var backlogFlushTask: Task<Void, Never>?

    /// Applies frames the backlog handed back. More than one means a replay:
    /// work already over, so it lands as state rather than as animation.
    private func applyFrames(_ frames: [StreamBacklog.Frame]) {
        guard !frames.isEmpty else { return }
        withTransaction(Transaction(animation: frames.count > 1 ? nil : .default)) {
            for frame in frames {
                handle(frame: frame.value, type: frame.type)
            }
        }
        // A lone frame is the stream's head; the replay lands as a batch.
        if frames.count > 1 { revealAfterReplay() }
    }

    /// Set while opening a conversation re-attaches to its running turn. The
    /// stored transcript stops at the last user message — the turn lives only
    /// in the replay — so the view keeps it hidden until the replay lands,
    /// instead of showing the turn missing and then filling it in. Only the
    /// transcript waits: the session is `loaded`, so everything gated on that
    /// (permission mode, composer, idle poll) runs as usual.
    private(set) var awaitingReplay = false

    private func revealAfterReplay() {
        awaitingReplay = false
    }

    /// Held frames must never wait on a frame that may never come: a burst
    /// that stops — the replay caught up, the agent is thinking — lands on
    /// this timer instead.
    private func scheduleBacklogFlush() {
        backlogFlushTask?.cancel()
        guard let deadline = backlog.deadline else { backlogFlushTask = nil; return }
        backlogFlushTask = Task { @MainActor [weak self] in
            let wait = deadline.timeIntervalSinceNow
            if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
            guard let self, !Task.isCancelled else { return }
            backlogFlushTask = nil
            applyFrames(backlog.framesDue(at: Date()))
        }
    }

    private func cancelBacklogFlush() {
        backlogFlushTask?.cancel()
        backlogFlushTask = nil
    }

    /// A run we aborted; the idle poll must not re-attach to it.
    private var lastStoppedStreamId: String?
    /// The server said it owns this transcript (native runtime or Slack);
    /// PUTs are pointless from then on.
    private var transcriptOwnedByServer = false

    /// `agentRuntime` / `runtimeLabel` are what the list already knows about
    /// the conversation; carrying them in means the chat can say which agent
    /// answers before its detail arrives. `load()` refines them.
    init(
        token: String,
        teamId: String,
        sessionId: String = UUID().uuidString.lowercased(),
        title: String = "New chat",
        agentRuntime: String? = nil,
        runtimeLabel: String? = nil
    ) {
        self.token = token
        self.teamId = teamId
        self.sessionId = sessionId
        self.title = title
        self.agentRuntime = agentRuntime
        self.runtimeLabel = runtimeLabel
    }

    /// A brand-new conversation, not yet known to the server.
    static func fresh(token: String, teamId: String) -> ChatSession {
        let s = ChatSession(token: token, teamId: teamId)
        s.loaded = true
        s.isOwner = true
        return s
    }

    #if DEBUG
    /// Seeds a canned transcript for UI previews (`-preview-approval`).
    func seedForPreview(_ seeded: [ChatMessage]) {
        messages = seeded
        loaded = true
    }
    #endif

    // MARK: - Loading

    /// Loads the tail of an existing conversation; if a reply is still
    /// running on the server, attaches to it.
    func load() async {
        do {
            let observedAt = ProcessInfo.processInfo.systemUptime
            let detail = try await NuphosAPI.conversationDetail(token: token, teamId: teamId, sessionId: sessionId)
            var msgs = detail.messages
            baseIndex = detail.messagesFirstIndex ?? 0
            readOnly = detail.readOnly ?? true
            isOwner = detail.isOwner ?? false
            canCancelRun = detail.canCancelRun ?? false
        canRespondToRun = detail.canRespondToRun ?? false
            if let t = detail.title, !t.isEmpty { title = t }
            adoptRuntime(from: detail)
            receiveRuntime(detail.runtimeState, observedAt: observedAt)
            if let stored = detail.credentialAccess {
                let selection = CredentialSelection(json: stored)
                credentialAccess = selection.isBlank ? nil : selection
            }
            Task { [weak self] in
                guard let self, canManage, let bypass = try? await AgentChatAPI.bypass(token: token, sessionId: sessionId) else { return }
                permissionMode = bypass ? .bypass : .auto
            }

            if let run = detail.activeRun {
                // Whatever assistant content is stored may be stale; the
                // replay from frame 0 rebuilds it.
                if !isNativeRuntime, let lastUser = msgs.lastIndex(where: { $0.role == .user }) {
                    msgs = Array(msgs[...lastUser])
                }
                messages = msgs
                loaded = true
                awaitingReplay = true
                startTurn(TurnOptions(streamId: run.streamId, explicitResume: true, resumeFrom: 0))
                // A replay that never arrives must not hide the chat for good.
                Task { [weak self] in
                    try? await Task.sleep(for: .seconds(1.5))
                    self?.revealAfterReplay()
                }
            } else {
                messages = msgs
                loaded = true
            }
            lastSyncedSignature = signature()
            if isNativeRuntime, !transportStreaming { Task { await refreshSessionConfig() } }
            if let text = sendAfterLoad {
                sendAfterLoad = nil
                if !readOnly, !transportStreaming { send(text) }
            }
        } catch {
            loadError = error.localizedDescription
            loaded = true
        }
    }

    // MARK: - Sending

    /// Sends `text`, or queues it while a reply is streaming.
    func send(_ text: String) {
        send(ComposerSubmission(text: text, attachments: []))
    }

    /// Sends text plus attachments. Runtime agents get every attachment from
    /// the transfer store, so the chat request stays small. The built-in agent
    /// still reads photos inline for vision; its files upload first.
    func send(_ submission: ComposerSubmission) {
        let trimmed = submission.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let attachments = submission.attachments
        guard !trimmed.isEmpty || !attachments.isEmpty, !readOnly else { return }
        guard canSubmit else { return }
        if canSteer {
            guard attachments.isEmpty else { error = "Send attachments after this turn; steering currently accepts text."; return }
            steeringPending = true
            Task { await steer(submission, text: trimmed) }
            return
        }
        if transportStreaming && !isNativeRuntime {
            if !trimmed.isEmpty {
                queued.append(trimmed)
                Analytics.shared.track("agent_message_queued", teamID: teamId)
            }
            return
        }
        var parts: [ChatPart] = []
        if !trimmed.isEmpty { parts.append(.text(.init(text: trimmed, state: .done))) }
        let uploads = isNativeRuntime ? attachments : attachments.filter { !$0.isImage }
        if !isNativeRuntime {
            for a in attachments {
                if let url = a.dataURL {
                    parts.append(.file(.init(mediaType: "image/jpeg", filename: a.name, url: url)))
                }
            }
        }
        failedSubmission = nil
        error = nil
        sending = Sending(submission: submission)
        let progress = sending!.progress
        sending?.task = Task {
            do {
                if !uploads.isEmpty {
                    let upload = try await WorkspaceAPI.upload(token: token, team: teamId, attachments: uploads, progress: progress)
                    parts.append(isNativeRuntime ? upload.part : .text(.init(text: upload.instruction, state: .done)))
                }
                sending = nil
                let message = ChatMessage(role: .user, parts: parts)
                await dispatch(message, title: trimmed.isEmpty ? (attachments.first?.name ?? "Attachment") : trimmed, submission: submission)
            } catch {
                sending = nil
                if !Task.isCancelled { self.error = error.localizedDescription }
                failedSubmission = submission
            }
        }
    }

    var failedSubmission: ComposerSubmission?

    /// Only restore a request rejected before admission, never a resumed turn.
    private func rejectOversizedSubmission(_ pending: (id: String, submission: ComposerSubmission)?) {
        guard let pending else { return }
        failedSubmission = pending.submission
        messages.removeAll { $0.id == pending.id }
    }

    func removeQueued(at index: Int) {
        guard queued.indices.contains(index) else { return }
        queued.remove(at: index)
    }

    /// Hands a message to the running turn (`POST …/steer`). The runtime
    /// picks it up at its next prompt boundary; the transcript snapshot at
    /// the end of the turn shows it in place. The status that offered
    /// steering can be seconds old, so a turn that ended meanwhile rejects
    /// it — the message then goes back to the composer instead of waiting
    /// for a turn that will never take it.
    private func steer(_ submission: ComposerSubmission, text: String) async {
        let streamId = currentStreamId
        let assistantId = messages.last?.id
        defer { steeringPending = false }
        do {
            let id = try await AgentChatAPI.steer(token: token, teamId: teamId, sessionId: sessionId, text: text)
            Analytics.shared.track("agent_message_sent", teamID: teamId, properties: ["mode": "steer"])
            if currentStreamId == streamId, messages.last?.id == assistantId {
                appendSteering(id: id, text: text)
                lastSubmittedRowID = "steering.\(id)"
            }
        } catch {
            self.error = error.localizedDescription
            failedSubmission = submission
        }
    }

    // MARK: - Model settings

    func refreshSessionConfig() async {
        guard isOwner, !readOnly, !isNew, isNativeRuntime, !sessionConfigSaving, !sessionConfigReading else { return }
        let request = UUID()
        sessionConfigRequest = request
        sessionConfigReading = true
        defer { sessionConfigReading = false }
        do {
            let incoming = try await AgentChatAPI.sessionConfig(token: token, teamId: teamId, sessionId: sessionId)
            guard sessionConfigRequest == request else { return }
            sessionConfig = incoming.retainingOptions(from: sessionConfig)
            sessionConfigError = nil
        } catch {
            guard sessionConfigRequest == request else { return }
            sessionConfigError = error.localizedDescription
        }
        await applyPendingModelSettings()
    }

    private func applyPendingModelSettings() async {
        guard canManage, !isStreaming, !sessionConfigSaving, sessionConfigError == nil,
              let config = sessionConfig, [.ready, .dormant].contains(config.status),
              !pendingModelSettings.isEmpty else { return }
        guard let next = config.nextSelection(in: &pendingModelSettings, streaming: isStreaming) else { return }
        await setSessionConfig(configId: next.id, value: next.value)
    }

    func setSessionConfig(configId: String, value: String) async {
        guard canManage, !sessionConfigSaving, sessionConfigError == nil, sessionConfig?.isEditable == true else { return }
        if isStreaming || sessionConfig?.status == .busy {
            pendingModelSettings[configId] = value
            return
        }
        sessionConfigSaving = true
        sessionConfigRequest = UUID()
        do {
            sessionConfig = try await AgentChatAPI.setSessionConfig(token: token, teamId: teamId, sessionId: sessionId, configId: configId, value: value)
            sessionConfigError = nil
        } catch {
            pendingModelSettings.removeAll()
            sessionConfigError = error.localizedDescription
        }
        sessionConfigSaving = false
        await applyPendingModelSettings()
    }

    // MARK: - Archive

    func rename(_ name: String) async throws {
        guard canManage else { throw NuphosAPI.Failure.http(403, message: "Only the chat owner can rename it.") }
        struct Body: Encodable { let title: String }
        _ = try await AgentChatAPI.send("PATCH", "agent/conversations/\(sessionId)/title", query: [URLQueryItem(name: "teamId", value: teamId)], token: token, body: Body(title: name))
        title = name
    }

    func setArchived(_ archived: Bool) async throws {
        guard canManage else { throw NuphosAPI.Failure.http(403, message: "Only the chat owner can archive it.") }
        try await AgentChatAPI.setArchived(token: token, teamId: teamId, sessionId: sessionId, archived: archived)
        isArchived = archived
    }

    private func dispatch(_ text: String) async {
        await dispatch(.user(text), title: text)
    }

    /// Who is signed in, shown on what they send until the server's own
    /// sender metadata for the message arrives.
    var me: ChatMessage.Sender?
    private(set) var sentHere: Set<String> = []

    private func dispatch(_ message: ChatMessage, title text: String, submission: ComposerSubmission? = nil) async {
        sentHere.insert(message.id)
        let wasEmpty = messages.isEmpty
        // Send intent, matching Desktop; this is not a successful agent outcome.
        Analytics.shared.track("agent_message_sent", teamID: teamId, properties: [
            "attachment_count": submission?.attachments.count ?? 0,
            "mode": "send",
        ])
        if wasEmpty { Analytics.shared.track("agent_chat_started", teamID: teamId) }
        if !isNativeRuntime, let i = messages.lastIndex(where: { $0.role == .assistant }) {
            messages[i].supersedePendingApprovals()
            messages[i].finalizeIncompleteTools()
        }
        messages.append(message)
        lastSubmittedRowID = "user.\(message.id)"
        if wasEmpty {
            title = text.count > 32 ? String(text.prefix(32)) + "…" : text
        }
        error = nil
        stoppedByUser = false

        // The chat endpoint persists the user message after admission. Avoid
        // writing an optimistic row that a size check or proxy can reject.
        startTurn(TurnOptions(
            streamId: newId(),
            submission: submission.map { (message.id, $0) },
            permissionMode: wasEmpty ? permissionMode.rawValue : nil,
            agentRuntime: wasEmpty ? runtime?.provider.rawValue : nil,
            runtimeId: wasEmpty ? runtime?.id : nil,
            initialSessionConfig: wasEmpty ? initialSessionConfig : nil
        ))
    }

    // MARK: - Approvals

    enum ApprovalDecision: Equatable {
        case once
        case session
        case always(rule: String)
        case deny
    }

    /// Answers an `approval-requested` tool call and resumes the turn.
    func decide(toolCallId: String, _ decision: ApprovalDecision) {
        guard canReply, let (mi, pi, part) = findTool(toolCallId) else { return }
        var updated = part
        updated.state = .approvalResponded
        updated.approval?.approved = decision != .deny
        updated.startedAt = Date.now.timeIntervalSince1970 * 1000
        messages[mi].parts[pi] = .tool(updated)
        error = nil

        Task {
            switch decision {
            case .session:
                if let command = part.input?["command"]?.stringValue {
                    try? await AgentChatAPI.approveForSession(token: token, sessionId: sessionId, command: command)
                }
            case .always(let rule):
                try? await AgentChatAPI.createPolicyRule(token: token, description: rule)
            case .once, .deny:
                break
            }
            startTurn(TurnOptions(streamId: newId(), continueAfterInterruption: true, resumeReason: "approval-decision"))
        }
    }

    /// `propose_authorization_rule` follow-ups.
    func confirmProposedRule(ruleId: String) async -> Bool {
        (try? await AgentChatAPI.activatePolicyRule(token: token, ruleId: ruleId)) != nil
    }

    func dismissProposedRule(ruleId: String) async -> Bool {
        (try? await AgentChatAPI.deletePolicyRule(token: token, ruleId: ruleId)) != nil
    }

    // MARK: - Plans

    func plan(_ planId: String) async throws -> Plan {
        try await AgentChatAPI.plan(token: token, teamId: teamId, planId: planId)
    }

    /// Approve → if the quorum is met, tell the agent to proceed.
    func approvePlan(_ planId: String) async throws -> Plan {
        let updated = try await AgentChatAPI.updatePlan(token: token, teamId: teamId, planId: planId, status: "approved")
        Analytics.shared.track("agent_plan_approved", teamID: teamId, properties: ["plan_id": planId])
        if updated.status == "approved" {
            send("Approved plan #\(planId) — please proceed with plan #\(planId).")
        }
        return updated
    }

    func rejectPlan(_ planId: String) async throws -> Plan {
        let updated = try await AgentChatAPI.updatePlan(token: token, teamId: teamId, planId: planId, status: "rejected")
        Analytics.shared.track("agent_plan_rejected", teamID: teamId, properties: ["plan_id": planId])
        send("Rejected the plan — discard it and stop.")
        return updated
    }

    func requestPlanChanges(_ reason: String) {
        send("Requested changes to the plan. \(reason)")
    }

    // MARK: - Feedback

    func rate(messageId: String, rating: String?) async {
        guard canManage else { return }
        try? await AgentChatAPI.feedback(token: token, teamId: teamId, sessionId: sessionId, messageId: messageId, rating: rating)
        if let i = messages.firstIndex(where: { $0.id == messageId }) { messages[i].feedback = rating }
    }

    // MARK: - Stop

    /// Asks the runtime to stop. The stream stays open: the runtime closes
    /// the turn with its own terminal frames (and persists what it did). If
    /// those never come, the turn is closed locally after the last probe.
    func stop() {
        if isNativeRuntime {
            guard canCancel else { return }
            isStopping = true
            Task {
                defer { isStopping = false }
                do { try await AgentChatAPI.cancelRuntime(token: token, teamId: teamId, sessionId: sessionId) }
                catch { self.error = error.localizedDescription }
            }
            return
        }
        guard transportStreaming, !isStopping else { return }
        stoppedByUser = true
        isStopping = true
        phaseLabel = "Stopping…"
        queued = []
        guard let streamId = currentStreamId else { forceLocalStop(); return }
        lastStoppedStreamId = streamId
        Task { [weak self] in
            guard let self else { return }
            let status = await AgentChatAPI.abort(token: token, streamId: streamId)
            if status == .failed { forceLocalStop(); return }
            for delay in [1.0, 5.0, 15.0] {
                try? await Task.sleep(for: .seconds(delay))
                guard transportStreaming, currentStreamId == streamId else { return }
                let detail = try? await NuphosAPI.conversationDetail(token: token, teamId: teamId, sessionId: sessionId, tail: 1)
                if let detail, detail.activeRun?.streamId != streamId { forceLocalStop(); return }
            }
            if transportStreaming, currentStreamId == streamId { forceLocalStop() }
        }
    }

    /// The pre-runtime stop: close the reply here and persist it ourselves.
    private func forceLocalStop() {
        guard transportStreaming else { isStopping = false; return }
        streamTask?.cancel()
        streamTask = nil
        cancelBacklogFlush()
        if let i = messages.lastIndex(where: { $0.role == .assistant }) {
            messages[i].finalizeIncompleteTools(errorText: "Stopped by user.")
            messages[i].stoppedByUser = true
            closeStreamingParts(at: i)
        }
        transportStreaming = false
        isStopping = false
        phaseLabel = nil
        currentStreamId = nil
        scheduleTranscriptSync(after: .milliseconds(250))
        Task { await reloadFromServer() }
    }

    // MARK: - Turn loop

    struct TurnOptions {
        var streamId: String
        var submission: (id: String, submission: ComposerSubmission)?
        var explicitResume = false
        var resumeFrom = 0
        var continueAfterInterruption = false
        var resumeReason: String?
        var permissionMode: String?
        var agentRuntime: String?
        var runtimeId: String?
        var initialSessionConfig: [String: String]?
    }

    private enum TurnResult {
        case completed(sawTurnComplete: Bool, paused: Paused?)
        case failed(String)
        case aborted
    }

    private struct Paused {
        var reason: String
        var detail: JSONValue?
        var autoResumable: Bool { reason == "model-silence" || reason == "tool-execution-timeout" }
    }

    private func startTurn(_ options: TurnOptions) {
        streamTask?.cancel()
        cancelBacklogFlush()
        transportStreaming = true
        isStopping = false
        stoppedByUser = false
        error = nil
        turnStartedAt = .now
        currentStreamId = options.streamId
        awaitingAdmission = isNativeRuntime && !options.explicitResume
        streamTask = Task { [weak self] in
            guard let self else { return }
            var options = options
            while true {
                let result = await runTurn(options)
                guard !Task.isCancelled, currentStreamId == options.streamId else { return }
                switch result {
                case .aborted:
                    // A cancelled URL request without task cancellation is only a lost subscription.
                    finishTurn(error: nil)
                    return
                case .failed(let message):
                    finishTurn(error: message)
                    return
                case .completed(let sawTurnComplete, let paused):
                    if stoppedByUser || paused?.reason == "stopped-by-user" {
                        finishTurn(error: nil)
                        return
                    }
                    if !isNativeRuntime, !sawTurnComplete, paused == nil || paused!.autoResumable, autoResumeAttempts < 10 {
                        autoResumeAttempts += 1
                        finalizeOrphans()
                        options = TurnOptions(streamId: newId(), continueAfterInterruption: true)
                        currentStreamId = options.streamId
                        continue
                    }
                    if !sawTurnComplete, let paused {
                        finishTurn(error: describeStall(paused))
                        return
                    }
                    finishTurn(error: nil)
                    return
                }
            }
        }
    }

    private func finishTurn(error message: String?) {
        awaitingAdmission = false
        if !isNativeRuntime { finalizeOrphans() }
        if let i = messages.lastIndex(where: { $0.role == .assistant }) {
            closeStreamingParts(at: i)
            if stoppedByUser { messages[i].stoppedByUser = true }
        }
        let wasStopped = stoppedByUser
        transportStreaming = false
        isStopping = false
        phaseLabel = nil
        currentStreamId = nil
        if let message {
            error = message
            scheduleTranscriptSync(after: .milliseconds(250))
        } else if !isNativeRuntime, !wasStopped, let last = messages.last, last.role == .assistant, !last.hasRenderableContent {
            error = "The agent returned an empty reply."
            scheduleTranscriptSync(after: .milliseconds(250))
        }

        Task {
            if message == nil || wasStopped { await reloadFromServer() }
            if isNativeRuntime { await refreshSessionConfig() }
            if !isNativeRuntime, message == nil, !wasStopped, !queued.isEmpty {
                let next = queued.removeFirst()
                await dispatch(next)
            }
        }
    }

    /// After a turn the server holds the canonical transcript (its own ids
    /// for assistant and steered messages); adopt it when it has at least
    /// what we have.
    func reloadFromServer() async {
        try? await Task.sleep(for: .milliseconds(400))
        guard !transportStreaming, !submitting else { return }
        let previousSignature = signature()
        let observedAt = ProcessInfo.processInfo.systemUptime
        guard let detail = try? await NuphosAPI.conversationDetail(token: token, teamId: teamId, sessionId: sessionId) else { return }
        guard !transportStreaming, !submitting, signature() == previousSignature else { return }
        receiveRuntime(detail.runtimeState, observedAt: observedAt)
        let serverTotal = (detail.messagesFirstIndex ?? 0) + detail.messages.count
        let localTotal = baseIndex + messages.count
        guard serverTotal >= localTotal, !detail.messages.isEmpty else { return }

        let serverBase = detail.messagesFirstIndex ?? 0
        if isNativeRuntime {
            messages = RuntimeTranscript.reconcile(server: detail.messages, serverBase: serverBase, local: messages, localBase: baseIndex)
            baseIndex = serverBase
        } else if serverTotal == localTotal, serverBase == baseIndex,
           zip(detail.messages, messages).allSatisfy({ $0.role == $1.role }) {
            messages = zip(detail.messages, messages).map { server, local in
                var m = local
                m.id = server.id
                m.createdAt = server.createdAt ?? local.createdAt
                m.feedback = server.feedback ?? local.feedback
                m.metadata = server.metadata
                return m
            }
        } else {
            messages = detail.messages
            baseIndex = serverBase
        }
        if let t = detail.title, !t.isEmpty { title = t }
        adoptRuntime(from: detail)
        lastSyncedSignature = signature()
    }

    private func adoptRuntime(from detail: AgentConversationDetail) {
        isOwner = detail.isOwner ?? false
        canCancelRun = detail.canCancelRun ?? false
        canRespondToRun = detail.canRespondToRun ?? false
        readOnly = detail.readOnly ?? true
        if let r = detail.agentRuntime { agentRuntime = r }
        if let l = detail.runtimeLabel { runtimeLabel = l }
        timelineEvents = detail.timelineEvents
        isArchived = detail.archivedAt != nil
    }

    /// Idle poll: the Claude Code runtime can start turns on its own
    /// (scheduled wake-ups); attach to them, or pick up what it persisted.
    func pollWhileIdle() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3))
            observations.tick()
            guard !Task.isCancelled, loaded, loadError == nil, !messages.isEmpty, !submitting else { continue }
            let observedAt = ProcessInfo.processInfo.systemUptime
            let previousSignature = signature()
            let attached = attachedStreamId
            guard let detail = try? await NuphosAPI.conversationDetail(token: token, teamId: teamId, sessionId: sessionId) else { continue }
            guard !Task.isCancelled else { return }
            receiveRuntime(detail.runtimeState, observedAt: observedAt)
            adoptRuntime(from: detail)
            if !pendingModelSettings.isEmpty { await refreshSessionConfig() }
            guard !submitting, attachedStreamId == attached else { continue }
            let follow = RuntimeTranscript.runToFollow(active: detail.activeRun?.streamId, attached: attached, stopped: lastStoppedStreamId)
            let mayMove = attached == nil ? signature() == previousSignature : isNativeRuntime && !awaitingAdmission
            if let follow, mayMove {
                RuntimeTranscript.adopt(
                    snapshot: detail.messages,
                    firstIndex: detail.messagesFirstIndex,
                    messages: &messages,
                    baseIndex: &baseIndex
                )
                startTurn(TurnOptions(streamId: follow, explicitResume: true, resumeFrom: 0))
                continue
            }
            guard attached == nil, signature() == previousSignature else { continue }
            await reloadFromServer()
        }
    }

    private var attachedStreamId: String? { transportStreaming ? currentStreamId : nil }

    private func appendSteering(id: String, text: String) {
        RuntimeTranscript.steering(id: id, text: text, messages: &messages)
    }

    /// One connection attempt loop for a turn — reconnects, fresh retries
    /// and transcript rebases happen inside; returns once the turn is over.
    private func runTurn(_ options: TurnOptions) async -> TurnResult {
        var resumeFrom = options.resumeFrom
        var reconnects = 0
        var freshRetries = 0
        var idleTimeouts = 0
        var gatewayRetries = 0
        var notReadyRetries = 0
        var forceFresh = false
        var usedFreshFallback = false
        var accepted = false
        var sendFullTranscript = false
        var rebaseTo: Int?
        var toolExecutionMayHaveStarted = false
        var sawTurnComplete = false
        var paused: Paused?
        var lastErrorText: String?
        streamAssistantIndex = nil
        streamReducer = nil
        backlog = StreamBacklog()

        while !Task.isCancelled {
            let shouldResume = !forceFresh && (options.explicitResume || reconnects > 0 || resumeFrom > 0)
            forceFresh = false

            let window = transcriptWindow(full: sendFullTranscript, rebase: rebaseTo)
            let firstPost = resumeFrom == 0 && !accepted
            let body = AgentChatAPI.ChatRequest(
                id: sessionId,
                teamId: teamId,
                messages: window.messages.map(\.forWire),
                baseIndex: window.baseIndex > 0 ? window.baseIndex : nil,
                streamId: options.streamId,
                resume: shouldResume,
                resumeFrom: resumeFrom,
                continueAfterInterruption: options.continueAfterInterruption && firstPost ? true : nil,
                resumeReason: firstPost ? options.resumeReason : nil,
                permissionMode: options.permissionMode,
                credentialAccess: credentialAccess?.json,
                agentRuntime: firstPost ? options.agentRuntime : nil,
                runtimeId: firstPost ? options.runtimeId : nil,
                initialSessionConfig: firstPost ? options.initialSessionConfig : nil,
                clientCapabilities: ["localTools": false]
            )

            var needsFreshRetry = false
            var terminal = false

            do {
                defer { applyFrames(backlog.flush()) }
                let request = try AgentChatAPI.chatRequest(token: token, body: body)
                debugLog("POST /agent/chat stream=\(options.streamId.prefix(8)) resume=\(shouldResume) from=\(resumeFrom) msgs=\(window.messages.count) base=\(window.baseIndex)")
                for try await event in SSEClient.events(for: request) {
                    if Task.isCancelled { return .aborted }
                    guard event.data != "[DONE]", let frame = JSONValue.parse(event.data),
                          let type = frame["type"]?.stringValue else { continue }
                    accepted = true
                    debugLog("frame \(type)")
                    if type.hasPrefix("tool-") || type == "authorization-decision" || type == "error" || type == "atlas-turn-paused" {
                        debugLog("  \(frame.compact.prefix(600))")
                    }

                    resumeFrom += 1
                    if type == "error" {
                        let code = frame["errorCode"]?.stringValue
                        if code == "stream_unresumable", sawTurnComplete { continue }
                        lastErrorText = frame["errorText"]?.stringValue ?? "The agent hit an error."
                        // A signed-out agent runtime is not transient: every fresh
                        // retry re-hits the same missing credential, so fail with the
                        // sign-in guidance the backend already wrote.
                        if code == "runtime_auth_required" {
                            return .failed(lastErrorText ?? "The agent hit an error.")
                        }
                        needsFreshRetry = true
                        continue
                    }

                    reconnects = 0
                    idleTimeouts = 0

                    if type == "atlas-stream-done" {
                        if !needsFreshRetry { terminal = true }
                        break
                    }
                    if ["tool-input-available", "tool-output-available", "tool-output-error", "tool-approval-request"].contains(type) {
                        toolExecutionMayHaveStarted = true
                    }
                    if type == "atlas-turn-complete" { sawTurnComplete = true }
                    if type == "atlas-turn-paused" {
                        paused = Paused(reason: frame["reason"]?.stringValue ?? "other", detail: frame["detail"])
                    }
                    autoResumeAttempts = 0
                    applyFrames(backlog.receive(frame, type: type, at: Date()))
                    scheduleBacklogFlush()
                }
            } catch is CancellationError {
                return .aborted
            } catch let urlError as URLError where urlError.code == .cancelled {
                return .aborted
            } catch is ChatPayload.TooLarge {
                if !accepted && !shouldResume && reconnects == 0 { rejectOversizedSubmission(options.submission) }
                return .failed(ChatPayload.tooLargeMessage)
            } catch SSEClient.Failure.badStatus(let status, let bodyText) {
                if status == 413 {
                    if !accepted && !shouldResume && reconnects == 0 { rejectOversizedSubmission(options.submission) }
                    return .failed(ChatPayload.tooLargeMessage)
                }
                let conflict = AgentChatAPI.conflict(status: status, body: bodyText)
                debugLog("HTTP \(status): \(bodyText ?? "")")
                switch conflict {
                case .streamNotResumable where !isNativeRuntime && shouldResume && resumeFrom == 0 && !options.explicitResume && !usedFreshFallback:
                    usedFreshFallback = true
                    forceFresh = true
                    continue
                case .transcriptOutOfSync(let stored) where !sendFullTranscript:
                    if let stored, rebaseTo == nil { rebaseTo = stored } else { sendFullTranscript = true }
                    continue
                case .runtimeNotReady where !accepted && notReadyRetries < 30:
                    notReadyRetries += 1
                    phaseLabel = "Waiting for the agent to be ready…"
                    try? await Task.sleep(for: backoff(notReadyRetries, base: 0.5, max: 3))
                    continue
                case .other(_, _, let code) where reconnects == 0 && [502, 503, 504, 520, 521, 522, 523, 524].contains(code) && gatewayRetries < 3:
                    gatewayRetries += 1
                    try? await Task.sleep(for: backoff(gatewayRetries, base: 0.7, max: 5))
                    if !isNativeRuntime && !options.explicitResume { forceFresh = true; resumeFrom = 0 } else { reconnects += 1 }
                    continue
                default:
                    return .failed(conflict.localizedDescription)
                }
            } catch SSEClient.Failure.frameTimeout {
                return .failed(SSEClient.Failure.frameTimeout.localizedDescription)
            } catch SSEClient.Failure.idleTimeout {
                debugLog("idle timeout")
                idleTimeouts += 1
                if idleTimeouts > 3 { return .failed("The connection kept going quiet; please try again.") }
                reconnects += 1
                continue
            } catch {
                if Task.isCancelled { return .aborted }
                debugLog("stream error: \(error)")
                reconnects += 1
                phaseLabel = "Reconnecting…"
                if reconnects > 20 { return .failed(error.localizedDescription) }
                try? await Task.sleep(for: backoff(reconnects, base: 0.5, max: 5))
                continue
            }

            if Task.isCancelled { return .aborted }

            if needsFreshRetry {
                if isNativeRuntime || options.explicitResume || toolExecutionMayHaveStarted {
                    return .failed(lastErrorText ?? "The agent hit an error.")
                }
                freshRetries += 1
                if freshRetries > 3 { return .failed(lastErrorText ?? "The agent hit an error.") }
                // Drop the partial reply and start the turn over.
                if let i = streamAssistantIndex, messages.indices.contains(i) { messages.remove(at: i) }
                streamAssistantIndex = nil
                streamReducer = nil
                forceFresh = true
                resumeFrom = 0
                try? await Task.sleep(for: backoff(freshRetries, base: 0.6, max: 4))
                continue
            }

            if terminal || sawTurnComplete {
                return .completed(sawTurnComplete: sawTurnComplete, paused: paused)
            }

            // Closed without a terminal frame: reconnect and resume.
            debugLog("stream closed without terminal frame (frames so far: \(resumeFrom))")
            reconnects += 1
            phaseLabel = "Reconnecting…"
            if reconnects > 20 { return .failed("Lost the connection to Nuphos.") }
            try? await Task.sleep(for: backoff(reconnects, base: 0.5, max: 5))
        }
        return .aborted
    }

    /// Routes one frame: SDK frames into the streamReducer, Atlas frames into
    /// session state.
    private func handle(frame: JSONValue, type: String) {
        switch type {
        case "runtime-state":
            let age = max(0, Date.now.timeIntervalSince1970 - (frame["emittedAt"]?.numberValue ?? 0) / 1000)
            receiveRuntime(frame["snapshot"], observedAt: ProcessInfo.processInfo.systemUptime - age)
            return
        case "data-steering":
            if let id = frame["data"]?["id"]?.stringValue, let text = frame["data"]?["text"]?.stringValue {
                appendSteering(id: id, text: text)
                if let i = streamAssistantIndex, messages.indices.contains(i) { streamReducer?.message.parts = messages[i].parts }
            }
            return
        case "phase":
            if !isStopping { phaseLabel = Self.phaseLabel(frame["phase"]?.stringValue) }
            return
        case "atlas-turn-complete", "atlas-turn-paused":
            awaitingAdmission = false
            if let turn = frame["turnKey"]?.stringValue ?? currentStreamId {
                ConversationUnread.shared.observe(team: teamId, session: sessionId, turn: turn)
            }
            phaseLabel = nil
            return
        case "atlas-transcript-snapshot":
            // The server's authoritative ordering for the whole conversation.
            guard let raw = frame["messages"]?.arrayValue else { return }
            let decoded = raw.compactMap { value -> ChatMessage? in
                guard let data = try? JSONEncoder().encode(value) else { return nil }
                return try? Self.snapshotDecoder.decode(ChatMessage.self, from: data)
            }
            guard !decoded.isEmpty else { return }
            messages = decoded
            baseIndex = 0
            streamAssistantIndex = messages.lastIndex { $0.role == .assistant }
            streamReducer = streamAssistantIndex.map { UIStreamReducer(message: messages[$0]) }
            lastSyncedSignature = signature()
            transcriptOwnedByServer = true
            return
        case "turn-interrupted":
            guard let part = ChatPart.TurnInterruptedPart(json: frame) else { return }
            if streamAssistantIndex == nil {
                let m = ChatMessage(role: .assistant, parts: [])
                messages.append(m)
                streamAssistantIndex = messages.count - 1
                streamReducer = UIStreamReducer(message: m)
            }
            guard let i = streamAssistantIndex else { return }
            messages[i].parts.removeAll { if case .turnInterrupted(let p) = $0 { return p.id == part.id }; return false }
            messages[i].parts.append(.turnInterrupted(part))
            streamReducer?.message.parts = messages[i].parts
            return
        case "atlas-turn-start":
            guard let raw = frame["messages"]?.arrayValue else { return }
            let input = raw.compactMap { value -> ChatMessage? in
                guard let data = try? JSONEncoder().encode(value) else { return nil }
                return try? Self.snapshotDecoder.decode(ChatMessage.self, from: data)
            }
            RuntimeTranscript.userTurn(input, messages: &messages)
            streamAssistantIndex = nil
            streamReducer = nil
            return
        case "atlas-autonomous-turn-start":
            let messageId = frame["messageId"]?.stringValue ?? "autonomous:\(currentStreamId ?? sessionId)"
            let i = RuntimeTranscript.autonomous(messageId, messages: &messages)
            streamAssistantIndex = i
            streamReducer = UIStreamReducer(message: messages[i])
            return
        case "authorization-decision":
            guard let callId = frame["toolCallId"]?.stringValue, let (mi, pi, part) = findTool(callId) else { return }
            var t = part
            t.authorization = frame
            messages[mi].parts[pi] = .tool(t)
            return
        case "memory-ingest":
            applyMemoryIngest(frame, assistantIndex: streamAssistantIndex)
            return
        case "memory-provenance":
            applyMemoryProvenance(frame)
            return
        default:
            break
        }

        // A replay start targets its original message, never another bubble.
        if type == "start", let id = frame["messageId"]?.stringValue,
           let i = messages.firstIndex(where: { $0.id == id }) {
            messages[i].parts = []
            streamAssistantIndex = i
            streamReducer = UIStreamReducer(message: messages[i])
        }
        // SDK frame → the assistant message being built.
        if streamAssistantIndex == nil {
            let m = ChatMessage(role: .assistant, parts: [])
            messages.append(m)
            streamAssistantIndex = messages.count - 1
            streamReducer = UIStreamReducer(message: m)
        }
        guard let i = streamAssistantIndex, messages.indices.contains(i) else { return }
        if streamReducer == nil { streamReducer = UIStreamReducer(message: messages[i]) }

        if !isStopping {
            if type == "start" { phaseLabel = phaseLabel ?? "Thinking…" }
            if type == "text-delta" || type == "reasoning-delta" || type == "tool-input-start" { phaseLabel = nil }
            if type == "tool-output-available" || type == "tool-output-denied" {
                // After an approval the backend runs the command first.
                phaseLabel = nil
            }
        }

        streamReducer?.message.parts = messages[i].parts
        let outcome = streamReducer!.apply(frame)
        var updated = streamReducer!.message
        updated.createdAt = messages[i].createdAt ?? .now
        updated.turnOrigin = messages[i].turnOrigin
        messages[i] = updated
        if case .error(let text) = outcome { error = text }
        // The server persists the turn itself; no PUT while streaming.
    }

    /// "Memory recalled": kept at the top of the reply; a later frame with
    /// the same turn key (the post-turn replacement) supersedes the first.
    private func applyMemoryProvenance(_ frame: JSONValue) {
        let recalled = (frame["recalledPersonalIds"]?.arrayValue?.count ?? 0) + (frame["recalledTeamIds"]?.arrayValue?.count ?? 0)
        let fetched = frame["fetchedIds"]?.arrayValue?.count ?? 0
        if streamAssistantIndex == nil {
            let m = ChatMessage(role: .assistant, parts: [])
            messages.append(m)
            streamAssistantIndex = messages.count - 1
            streamReducer = UIStreamReducer(message: m)
        }
        guard let i = streamAssistantIndex else { return }
        let key = "\(frame["sessionId"]?.stringValue ?? "")/\(frame["turnKey"]?.stringValue ?? "")"
        var parts = messages[i].parts.filter { part in
            if case .other(let v) = part, v["type"]?.stringValue == "memory-provenance" {
                let k = "\(v["sessionId"]?.stringValue ?? "")/\(v["turnKey"]?.stringValue ?? "")"
                return k != key
            }
            return true
        }
        if recalled + fetched > 0 { parts.insert(.other(frame), at: 0) }
        messages[i].parts = parts
        streamReducer?.message.parts = parts
    }

    private func applyMemoryIngest(_ frame: JSONValue, assistantIndex: Int?) {
        guard let i = assistantIndex ?? messages.lastIndex(where: { $0.role == .assistant }) else { return }
        let eventId = frame["eventId"]?.stringValue ?? UUID().uuidString
        let created = frame["memoriesCreated"]?.numberValue ?? 0
        let updatedCount = frame["memoriesUpdated"]?.numberValue ?? 0
        let ok = frame["status"]?.stringValue == "ok" && frame["jobStatus"]?.stringValue == "succeeded" && created + updatedCount > 0
        messages[i].parts.removeAll { part in
            if case .other(let v) = part, v["type"]?.stringValue == "memory-ingest", v["eventId"]?.stringValue == eventId { return true }
            return false
        }
        if ok { messages[i].parts.append(.other(frame)) }
    }

    // MARK: - Transcript window

    /// The suffix from the last user message on, with `baseIndex` pointing at
    /// it — the desktop's `windowTranscript`.
    private func transcriptWindow(full: Bool, rebase: Int?) -> (messages: [ChatMessage], baseIndex: Int) {
        let base = rebase ?? baseIndex
        if full { return (messages, base) }
        guard let lastUser = messages.lastIndex(where: { $0.role == .user }), lastUser > 0 else {
            return (messages, base)
        }
        return (Array(messages[lastUser...]), base + lastUser)
    }

    // MARK: - Transcript sync

    private func signature() -> Int {
        var hasher = Hasher()
        hasher.combine(sessionId)
        hasher.combine(title)
        hasher.combine(baseIndex)
        for m in messages {
            hasher.combine(m.id)
            hasher.combine(m.role)
            hasher.combine(m.wireParts.map { $0.json.compact })
        }
        return hasher.finalize()
    }

    private func scheduleTranscriptSync(after delay: Duration) {
        transcriptSyncTask?.cancel()
        transcriptSyncTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled, let self else { return }
            await syncTranscriptNow()
        }
    }

    func syncTranscriptNow() async {
        guard canManage, !messages.isEmpty, !transcriptOwnedByServer else { return }
        let sig = signature()
        guard sig != lastSyncedSignature else { return }
        let wire = messages.map(\.forWire)
        // The first PUT of a new conversation binds it to its runtime.
        let binding = messages.count == 1 && baseIndex == 0 ? runtime : nil
        do {
            let skipped = try await AgentChatAPI.putTranscript(
                token: token, teamId: teamId, sessionId: sessionId, title: title,
                messages: wire, baseIndex: transcriptFullResend ? nil : (transcriptRebasedTo ?? baseIndex),
                agentRuntime: binding?.provider.rawValue, runtimeId: binding?.id
            )
            lastSyncedSignature = sig
            if skipped != nil { transcriptOwnedByServer = true }
        } catch AgentChatAPI.Conflict.transcriptOutOfSync(let stored) {
            if let stored, transcriptRebasedTo == nil, !transcriptFullResend {
                transcriptRebasedTo = stored
            } else {
                transcriptFullResend = true
            }
            // One retry with the adjusted base; give up quietly otherwise.
            if (try? await AgentChatAPI.putTranscript(
                token: token, teamId: teamId, sessionId: sessionId, title: title,
                messages: wire, baseIndex: transcriptFullResend ? nil : transcriptRebasedTo
            )) != nil {
                lastSyncedSignature = sig
            }
        } catch {
            // Best effort; the backend syncs its own copy at turn end.
            debugLog("transcript sync failed: \(error)")
        }
    }

    // MARK: - Helpers

    private func findTool(_ callId: String) -> (Int, Int, ChatPart.ToolPart)? {
        for mi in messages.indices.reversed() {
            for pi in messages[mi].parts.indices {
                if case .tool(let t) = messages[mi].parts[pi], t.toolCallId == callId { return (mi, pi, t) }
            }
        }
        return nil
    }

    private func finalizeOrphans() {
        if let i = messages.lastIndex(where: { $0.role == .assistant }) {
            messages[i].finalizeIncompleteTools()
        }
    }

    private func closeStreamingParts(at i: Int) {
        var r = UIStreamReducer(message: messages[i])
        r.finishStreamingParts()
        messages[i] = r.message
    }

    private func newId() -> String { UUID().uuidString.lowercased() }

    private static let logger = Logger(subsystem: "ai.nuphos.ios", category: "chat")

    private func debugLog(_ message: @autoclosure () -> String) {
        #if DEBUG
        let text = message()
        Self.logger.info("\(text, privacy: .public)")
        #endif
    }

    private func backoff(_ attempt: Int, base: Double, max cap: Double) -> Duration {
        .seconds(min(cap, base * pow(2, Double(max(0, attempt - 1)))))
    }

    private func describeStall(_ paused: Paused) -> String {
        switch paused.reason {
        case "model-silence": "The model stopped responding. Send a message to continue."
        case "tool-execution-timeout": "A tool ran for too long and was stopped."
        case "output-budget": "The reply hit its length limit."
        case "turn-deadline": "The reply hit its time limit."
        case "content-filter": "The reply was blocked by a content filter."
        case "shutdown": "The server restarted mid-reply. Send a message to continue."
        case "producer-stalled": "The runtime went quiet and the reply was closed. Send a message to continue."
        case "stream-ended-without-result": "The reply ended before the agent finished. Send a message to continue."
        default: "The reply was interrupted."
        }
    }

    static func phaseLabel(_ phase: String?) -> String? {
        switch phase {
        case "request-accepted": "Starting…"
        case "saving-turn": "Saving…"
        case "building-context": "Building context…"
        case "loading-credentials": "Loading credentials…"
        case "preparing-tools": "Preparing tools…"
        case "building-prompt": "Building prompt…"
        case "recalling-memory": "Recalling memory…"
        case "loading-compaction": "Loading history…"
        case "preparing-model": "Preparing model…"
        case "connecting-model": "Connecting…"
        case "thinking": "Thinking…"
        case "stopping": "Stopping…"
        default: nil
        }
    }

    private static let snapshotDecoder: JSONDecoder = {
        let d = JSONDecoder()
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        d.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            if let date = iso.date(from: raw) ?? plain.date(from: raw) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad date: \(raw)"))
        }
        return d
    }()
}
