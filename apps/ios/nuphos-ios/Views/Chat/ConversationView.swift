import SwiftUI

/// The chat screen: transcript rows, activity, approvals, and the composer.
struct ConversationView: View {
    @AppStorage(BotAvatars.enabledKey) private var botAvatars = true
    @Bindable var session: ChatSession
    /// First message for a brand-new chat, sent once the view appears.
    var initialPrompt: ComposerSubmission?
    /// Top-level page that presented this chat, used by navigation diagnostics.
    var sourcePage = HomePage.agent.rawValue

    @Environment(\.scenePhase) private var scenePhase
    @State private var readerID = UUID()
    @State private var onScreen = false
    @State private var draft = ""
    @State private var toolDetail: ChatPart.ToolPart?
    /// A plan link tapped in the transcript.
    @State private var planLink: PlanLink.Target?
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @State private var didSendInitial = false
    @Environment(AgentStore.self) private var store
    @State private var archiveError: String?
    @State private var updating = false
    @State private var width: CGFloat = 0
    #if os(iOS)
    @Environment(\.barButtonsInSideRail) private var barButtonsInSideRail
    #else
    private let barButtonsInSideRail = false
    #endif
    @State private var showRename = false
    @State private var renamedTitle = ""
    @State private var showRuntimes = false
    @State private var showShare = false
    /// The desktop open from this conversation: beside it where the window is wide, else full screen.
    @State private var desktop: DesktopSession?
    @State private var referencedAgents = ReferencedAgents()

    private var rows: [ChatRow] { ChatRow.rows(for: session) }

    private func updateReading() {
        ConversationUnread.shared.setReading(onScreen && scenePhase == .active, reader: readerID, team: session.teamId, session: session.sessionId)
    }

    /// Shown instead of the transcript while it loads or after it failed.
    @ViewBuilder
    private var placeholder: some View {
        if !session.loaded || session.awaitingReplay {
            ProgressView().tint(Theme.muted)
        } else if let loadError = session.loadError {
            ContentUnavailableView("Couldn't load this agent", systemImage: "exclamationmark.bubble", description: Text(loadError))
        }
    }

    private var showsTranscript: Bool { session.loaded && !session.awaitingReplay && session.loadError == nil }

    var body: some View {
        Group {
            #if os(iOS)
            // The transcript's controller also docks the composer, so it is
            // there while the chat loads too.
            transcript
            #else
            if showsTranscript { transcript } else { placeholder }
            #endif
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .desktop($desktop)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .background(Theme.chatCanvas)
        .safeAreaInset(edge: .top, spacing: 0) {
            if !session.resources.isEmpty { ResourceStrip(resources: session.resources) }
        }
        #if !os(iOS)
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        #endif
        .onAppear {
            UIEventLog.pageTransition(from: sourcePage, to: "chat")
            Analytics.shared.screen("chat", teamID: session.teamId)
            onScreen = true
            updateReading()
            if draft.isEmpty { draft = ComposerDrafts.text(team: session.teamId, session: session.sessionId) }
        }
        .onChange(of: draft) { _, text in
            ComposerDrafts.set(text, team: session.teamId, session: session.sessionId)
        }
        .onDisappear {
            UIEventLog.pageTransition(from: "chat", to: sourcePage)
            onScreen = false
            updateReading()
        }
        .onChange(of: scenePhase) { _, _ in updateReading() }
        .alert("Rename agent", isPresented: $showRename) {
            TextField("Title", text: $renamedTitle)
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                Task {
                    do { try await session.rename(renamedTitle.trimmingCharacters(in: .whitespacesAndNewlines)); await store.reload() }
                    catch { archiveError = error.localizedDescription }
                }
            }.disabled(renamedTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || renamedTitle.count > 120)
        }
        .navigationTitle(session.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .keepsNavigationBar()
        #endif
        .toolbar {
            ToolbarItem(placement: .principal) { titleBar }
            if !session.isNew {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Share", systemImage: "person.crop.circle.badge.plus") { showShare = true }
                        Button {
                            Task {
                                updating = true
                                defer { updating = false }
                                do { try await store.setPinned(!store.isPinned(session.sessionId), sessionId: session.sessionId, title: session.title) }
                                catch { archiveError = error.localizedDescription }
                            }
                        } label: {
                            Label(store.isPinned(session.sessionId) ? "Unpin" : "Pin", systemImage: store.isPinned(session.sessionId) ? "pin.slash" : "pin")
                        }
                        if let watching = session.isWatching {
                            Button {
                                Task {
                                    updating = true
                                    defer { updating = false }
                                    do { try await session.setWatching(!watching) }
                                    catch { archiveError = error.localizedDescription }
                                }
                            } label: {
                                Label(watching ? "Unwatch" : "Watch", systemImage: watching ? "bell.slash" : "bell")
                            }
                        }
                        if session.canOpenDesktop {
                            Button("Desktop", systemImage: "display") { desktop = session.makeDesktop() }
                        }
                        if session.ownsChat {
                            Button("Rename", systemImage: "pencil") { renamedTitle = session.title; showRename = true }
                        }
                        if session.canManage {
                            Button("Switch runtime", systemImage: "arrow.left.arrow.right") { showRuntimes = true }
                                .disabled(session.isStreaming)
                            Button {
                                // An archived chat leaves the list, so go
                                // back to it at once and archive from there,
                                // as a swipe does; a restored one rejoins it.
                                if !session.isArchived {
                                    dismiss()
                                    Task { await store.archive(sessionId: session.sessionId, teamId: session.teamId) }
                                    return
                                }
                                Task {
                                    updating = true
                                    defer { updating = false }
                                    do {
                                        try await session.setArchived(false)
                                        await store.reload()
                                    } catch { archiveError = error.localizedDescription }
                                }
                            } label: {
                                Label(session.isArchived ? "Restore from archive" : "Archive", systemImage: session.isArchived ? "tray.and.arrow.up" : "archivebox")
                            }
                        }
                    } label: {
                        // A Label, not a bare Image: the bar takes it as a
                        // native item, so the whole glass answers, not just
                        // the glyph.
                        Label("Agent options", systemImage: "ellipsis")
                    }
                    .disabled(updating)
                    .accessibilityLabel("Agent options")
                }
            }
        }
        .alert("Couldn't update agent", isPresented: Binding(get: { archiveError != nil }, set: { if !$0 { archiveError = nil } })) {
            Button("OK") { archiveError = nil }
        } message: {
            Text(archiveError ?? "")
        }
        .sheet(item: $toolDetail) { ToolDetailSheet(part: $0) }
        .sheet(isPresented: $showShare) { ShareSessionSheet(session: session).presentationDetents([.medium, .large]) }
        .sheet(isPresented: $showRuntimes) {
            RuntimePickerSheet(session: session) { runtime in
                Task {
                    updating = true
                    defer { updating = false }
                    do { try await session.move(to: runtime); await store.reload() }
                    catch { archiveError = error.localizedDescription }
                }
            }
        }
        .sheet(item: $planLink) { target in
            PlanLinkSheet(target: target, approve: { plan in try await session.approvePlan(plan.id) }) { planLink = nil }
        }
        .task {
            if session.isNew, let initialPrompt, !didSendInitial {
                didSendInitial = true
                session.send(initialPrompt)
            }
            #if DEBUG
            // `-approve-plan <id>`: exercise the approval round-trip.
            let args = CommandLine.arguments
            if let i = args.firstIndex(of: "-approve-plan"), i + 1 < args.count, !session.isNew {
                _ = try? await session.approvePlan(args[i + 1])
            }
            #endif
        }
        // SwiftUI cancels this when the chat leaves the screen; the stream
        // lives on the session, so close it here.
        .task {
            await session.pollWhileIdle()
            session.leave()
        }
        // A teammate's computer that asks its owner first: say so until they answer.
        .task(id: "\(ShareApprovalWait.asksOwner(conversationRuntime)).\(session.queuedSends)") {
            await store.loadRuntimes()
            guard ShareApprovalWait.asksOwner(conversationRuntime) else { return }
            while !Task.isCancelled, await session.refreshShareApproval() {
                try? await Task.sleep(for: .seconds(5))
            }
        }
        // New files land while a turn runs; read them once it settles.
        .task(id: "\(session.isStreaming).\(session.messages.count)") {
            await session.refreshResources()
            if !session.isStreaming { await session.refreshDownloads() }
        }
    }

    /// The conversation's title, with the agent that answers in it on a
    /// second, quieter line — where the composer's runtime chip used to be.
    private var titleBar: some View {
        HStack(spacing: 8) {
            AgentAvatar(agentId: session.sessionId, runtime: session.agentRuntime)
            VStack(alignment: .leading, spacing: 1) {
                Text(session.title)
                    .font(Theme.Text.label.weight(.semibold))
                    .foregroundStyle(Theme.heading)
                    .lineLimit(1)
                if session.loaded || session.runtimeDisplayName != nil {
                    let name = session.runtimeDisplayName
                    HStack(spacing: 4) {
                        if botAvatars { RuntimeMark(runtime: session.agentRuntime) }
                        Text(RuntimeInstance.Provider.detail(session.agentRuntime, instance: name))
                            .font(Theme.Text.micro)
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Runtime: \(RuntimeInstance.Provider.detail(session.agentRuntime, instance: name))")
                } else if !session.loaded {
                    Text(" ").font(Theme.Text.micro).accessibilityHidden(true)
                }
            }
        }
        // The principal item is only as wide as its content and centred, so
        // it is given all the room between the back and options buttons
        // (each 44 + 16 margin + 8 gap) to start the title on the left. On
        // iPhone Duo those buttons sit in the side rail, so the title gets
        // the whole bar.
        .frame(width: max(width - (barButtonsInSideRail ? 0 : 136), 0), alignment: .leading)
    }

    /// Plan links open the plan here, approved through this chat; other app
    /// pages open the way a link from outside does; everything else leaves.
    private func open(link url: URL) {
        switch AppLink(url) {
        case .plan(let target): planLink = target
        case .session(_, session.sessionId): break
        default: if !PushNotifications.shared.open(url) { openURL(url) }
        }
    }

    /// The agent this conversation runs on, when the catalog lists it.
    private var conversationRuntime: RuntimeInstance? {
        let id = session.runtimeId ?? session.runtime?.id
        return store.runtimes.first { $0.id == id }
    }

    /// The composer, with what waits on the owner of a shared computer and any queued messages above it.
    private var composer: some View {
        VStack(spacing: 0) {
            if let wait = session.shareApproval, ShareApprovalWait.asksOwner(conversationRuntime) {
                ShareApprovalStrip(
                    wait: wait,
                    computer: conversationRuntime?.local?.deviceLabel ?? "this computer"
                )
            }
            if !session.queued.isEmpty || !session.serverQueued.isEmpty {
                QueuedStrip(
                    items: session.queued.enumerated().map { .init(id: "local.\($0.offset)", text: $0.element, steering: false) }
                        + session.serverQueued.map { .init(id: $0.id, text: $0.text, steering: session.steeringQueued.contains($0.id)) },
                    canSteer: session.canSteer,
                    onEdit: { id in
                        Task {
                            guard let text = await takeBack(id) else { return }
                            draft = [draft, text].filter { !$0.isEmpty }.joined(separator: "\n\n")
                        }
                    },
                    onSteer: { id in Task { await session.steerQueued(id) } },
                    onRemove: { id in Task { _ = await takeBack(id) } }
                )
            }
            ChatComposerBar(
                text: $draft,
                isStreaming: session.isStreaming,
                canSend: session.canSubmit,
                canStop: session.canCancel,
                // While the agent cannot take a message, the button queues it.
                sendsDuringTurn: session.isNativeRuntime && !session.sendQueues,
                canSteer: session.canSteer,
                allowsAttachments: !session.canSteer,
                editRequest: $session.editingSubmission,
                mentions: MentionSource(
                    teamId: session.teamId,
                    // Only someone who may change the session's devices can bring one in.
                    devices: session.canManage ? store.credentialCatalog?.scoped(to: .devices).allItems ?? [] : [],
                    pickDevice: { device in
                        var selection = session.credentialAccess ?? CredentialSelection()
                        if !selection.contains(device) { selection.toggle(device); session.credentialAccess = selection }
                    },
                    search: { query in
                        await store.loadCredentialOptions()
                        return await store.mentionableSessions(teamId: session.teamId, excluding: session.sessionId, matching: query)
                    }
                ),
                voiceTeamId: session.teamId,
                onSend: { session.send($0) },
                onStop: { session.stop() }
            ) {
                if session.canManage { ComposerControls(
                    selection: Binding(
                        get: { session.credentialAccess ?? CredentialSelection() },
                        set: { session.credentialAccess = $0 }
                    ),
                    mode: Binding(get: { session.permissionMode }, set: { session.setPermissionMode($0) }),
                    session: session
                ) }
            }
        }
    }

    /// Takes a queued message back; its text, unless its turn already started.
    private func takeBack(_ id: String) async -> String? {
        if id.hasPrefix("local."), let index = Int(id.dropFirst(6)), session.queued.indices.contains(index) {
            let text = session.queued[index]
            session.removeQueued(at: index)
            return text
        }
        let text = session.serverQueued.first { $0.id == id }?.text
        return await session.unqueue(id) ? text : nil
    }

    /// UIKit owns the iOS transcript's layout and reading position.
    @ViewBuilder
    private var transcript: some View {
        #if os(iOS)
        TranscriptList(rows: showsTranscript ? rows : [], submittedRowID: session.lastSubmittedRowID, sessionID: session.sessionId,
                       composer: AnyView(composer.environment(store).readableWidth()), placeholder: AnyView(placeholder)) { row in
            AnyView(rowView(row)
                .padding(.horizontal, 16)
                .padding(.bottom, rowSpacing(row))
                .readableWidth())
        }
        // Under the bars too: the collection insets itself by the safe area,
        // and rows scroll beneath the bar's edge effect rather than being cut.
        .ignoresSafeArea(.all, edges: .bottom)
        .ignoresSafeArea(.container, edges: .top)
        #else
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(rows) { row in
                    rowView(row)
                        .id(row.id)
                        .padding(.horizontal, 16)
                        .padding(.bottom, rowSpacing(row))
                }
            }
            .padding(.top, 12)
        }
        .defaultScrollAnchor(.bottom)
        .onScrollGeometryChange(for: CGPoint.self) { geometry in
            geometry.contentOffset
        } action: { oldOffset, newOffset in
            guard oldOffset != newOffset else { return }
            UIEventLog.chatScroll(sessionId: session.sessionId, contentOffset: newOffset)
        }
        .scrollDismissesKeyboard(.interactively)
        #endif
    }

    private func rowSpacing(_ row: ChatRow) -> CGFloat {
        switch row {
        case .assistantText: 28
        case .user, .sending, .failed: 22
        case .timestamp: 14
        case .reasoning, .tool, .toolRun, .work, .memory, .memoryRecall, .downloads: 14
        case .activity, .hint, .event: 18
        }
    }

    @ViewBuilder
    private func rowView(_ row: ChatRow) -> some View {
        switch row {
        case .timestamp(_, let date):
            TimestampLabel(date: date)
        case .user(_, _, let text, let images, let sender, let transfers):
            UserBubble(text: text, images: images, sender: sender, transfers: transfers, session: session)
        case .assistantText(_, _, let text, let streaming):
            AssistantMarkdown(text: text, streaming: streaming, onLink: open(link:))
        case .reasoning(_, let part):
            ReasoningTile(part: part)
        case .tool(_, _, let part, let canDecide):
            if let reference = ThreadReference(part) {
                AgentThreadBadge(reference: reference, teamId: session.teamId, agents: referencedAgents, onLink: open(link:))
            } else {
                ToolCallRow(
                    part: part,
                    canDecide: canDecide,
                    session: session,
                    onOpen: { toolDetail = part }
                )
            }
        case .toolRun(_, _, let items, let live):
            ToolRunView(items: items, live: live, session: session, onOpen: { toolDetail = $0 })
        case .work(_, let inner, let duration):
            WorkGroup(rows: inner, duration: duration) { innerRow in
                AnyView(rowView(innerRow))
            }
        case .memory(_, let created, let updated):
            MemoryPill(created: created, updated: updated)
        case .memoryRecall(_, let entries, let fetched):
            MemoryRecallPill(entries: entries, fetched: fetched)
        case .downloads(_, let groupId):
            TransferCard(groupId: groupId, fromUser: false, session: session)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .activity(let text, let live):
            ActivityRow(text: text, live: live)
        case .sending:
            if let sending = session.sending {
                SendingBubble(submission: sending.submission, progress: sending.progress, onCancel: session.cancelSending)
            }
        case .failed:
            if let submission = session.failedSubmission {
                FailedBubble(submission: submission, onRetry: session.retryFailed, onEdit: session.editFailed)
            }
        case .hint(_, let text, let isError):
            HintRow(text: text, isError: isError)
        case .event(_, let event):
            EventLine(event: event, onLink: open(link:))
        }
    }
}

// MARK: - Rows

struct UserBubble: View {
    let text: String
    var images: [String] = []
    var sender: ChatMessage.Sender?
    var transfers: [TransferUpload] = []
    var session: ChatSession?

    @State private var expanded = false
    @Environment(\.transcriptReadingInteraction) private var readingInteraction

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            if let sender {
                HStack(spacing: 6) {
                    if let url = sender.avatar {
                        AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { Image(systemName: "person.circle") }
                            .frame(width: 20, height: 20).clipShape(Circle())
                    }
                    Text(sender.name).font(.caption).foregroundStyle(Theme.muted)
                }
            }
            if !images.isEmpty {
                HStack(spacing: 6) {
                    ForEach(Array(images.prefix(4).enumerated()), id: \.offset) { _, url in
                        DataURLImage(url: url)
                            .frame(width: 96, height: 96)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                }
            }
            if let session {
                ForEach(transfers, id: \.groupId) { transfer in
                    TransferCard(groupId: transfer.groupId, fromUser: true, session: session, names: transfer.files.map(\.fileName))
                }
            }
            if !text.isEmpty {
                let preview = MessagePreview.head(of: text)
                let folded = preview != nil && !expanded
                VStack(alignment: .leading, spacing: 8) {
                    // Folded, a selection would copy the preview instead of the message.
                    PlainMessageText(text: folded ? preview ?? text : text, selectable: !folded)
                    if preview != nil {
                        Button(expanded ? "Show less" : "Show more") {
                            // Like a step disclosure: a reading interaction,
                            // applied in one layout rather than animated.
                            disclose(readingInteraction) { expanded.toggle() }
                        }
                        .font(Theme.Text.label.weight(.medium))
                        .foregroundStyle(Theme.muted)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(Theme.bubble, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.leading, 56)
    }
}

/// The user's message while its attachments upload: what they sent, how far
/// the upload is, and a way to take it back.
struct SendingBubble: View {
    let submission: ComposerSubmission
    let progress: Progress
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            HStack(spacing: 6) {
                ForEach(submission.attachments.prefix(4)) { attachment in
                    AttachmentPreview(attachment: attachment)
                        .frame(width: 96, height: 96)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
            if !submission.text.isEmpty {
                PlainMessageText(text: MessagePreview.head(of: submission.text) ?? submission.text, selectable: false)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(Theme.bubble, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            HStack(spacing: 10) {
                // Progress is read, not stored: the bubble re-reads it twice a second.
                TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                    Text(label).font(Theme.Text.label).foregroundStyle(Theme.muted).monospacedDigit()
                }
                Button("Cancel", action: onCancel).font(Theme.Text.label)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.leading, 56)
    }

    private var label: String {
        // Nothing to upload, or every byte is out and the server is answering.
        guard progress.totalUnitCount > 0, progress.completedUnitCount < progress.totalUnitCount else { return "Sending…" }
        return "Uploading \(progress.completedUnitCount.formatted(.byteCount(style: .file))) of \(progress.totalUnitCount.formatted(.byteCount(style: .file)))"
    }
}

/// A message the server never took, kept where it was sent as messaging apps
/// do: marked as not sent, to send again as it is or take back to edit.
struct FailedBubble: View {
    let submission: ComposerSubmission
    let onRetry: () -> Void
    let onEdit: () -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            HStack(spacing: 6) {
                ForEach(submission.attachments.prefix(4)) { attachment in
                    AttachmentPreview(attachment: attachment)
                        .frame(width: 96, height: 96)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
            if !submission.text.isEmpty {
                PlainMessageText(text: MessagePreview.head(of: submission.text) ?? submission.text, selectable: false)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(Theme.bubble, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            HStack(spacing: 14) {
                Label("Not sent", systemImage: "exclamationmark.circle.fill")
                    .foregroundStyle(.red)
                Button("Retry", action: onRetry)
                Button("Edit", action: onEdit)
            }
            .font(Theme.Text.label)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.leading, 56)
    }
}

/// Renders a `data:` image URL (what user photos are stored as).
struct DataURLImage: View {
    let url: String

    var body: some View {
        #if canImport(UIKit)
        if let comma = url.firstIndex(of: ","), let data = Data(base64Encoded: String(url[url.index(after: comma)...])),
           let image = UIImage(data: data) {
            Image(uiImage: image).resizable().scaledToFill()
                .accessibilityLabel("Attached image")
        } else {
            Theme.bubble
        }
        #else
        Theme.bubble
        #endif
    }
}

/// Centred timestamp between messages.
struct TimestampLabel: View {
    let date: Date

    var body: some View {
        Text(ChatTime.label(for: date))
            .font(Theme.Text.caption)
            .foregroundStyle(Theme.muted)
            .frame(maxWidth: .infinity)
            .padding(.top, 4)
            .accessibilityLabel(date.formatted(date: .abbreviated, time: .shortened))
    }
}

/// A grey note — "Stopped.", the runtime's status — or a red error line.
/// Both read from the same edge as the messages above them.
struct HintRow: View {
    let text: String
    var isError = false

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            if isError {
                Image(systemName: "exclamationmark.triangle.fill").font(Theme.Text.caption)
            }
            Text(text).font(Theme.Text.label)
        }
        .foregroundStyle(isError ? Color.red : Theme.muted)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A message another session, a linked resource or a trigger delivered: one
/// muted line — who sent it and its first line — that expands to the full text.
struct EventLine: View {
    let event: ChatMessage.Event
    var onLink: ((URL) -> Void)?

    @State private var expanded = false
    @Environment(\.transcriptReadingInteraction) private var readingInteraction

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                disclose(readingInteraction) { expanded.toggle() }
            } label: {
                HStack(spacing: event.agentId == nil ? 5 : 8) {
                    if let agentId = event.agentId {
                        AgentAvatar(agentId: agentId, runtime: event.runtime)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.name).fontWeight(.medium).foregroundStyle(Theme.heading)
                            Text(event.text.prefix { $0 != "\n" })
                        }
                    } else {
                        if let logo = event.logo {
                            BrandLogo(name: logo, size: 13).foregroundStyle(Theme.heading)
                        } else {
                            Text(event.name.prefix(1).uppercased())
                                .font(.system(size: 8, weight: .semibold))
                                .foregroundStyle(.white)
                                .frame(width: 14, height: 14)
                                .background(Theme.muted, in: Circle())
                        }
                        Text(event.name).fontWeight(.medium).foregroundStyle(Theme.heading).layoutPriority(1)
                        Text(event.text.prefix { $0 != "\n" })
                    }
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                }
                .font(Theme.Text.caption)
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(event.name): \(event.text.prefix { $0 != "\n" })")
            .accessibilityHint(expanded ? "Collapses the message" : "Shows the full message")
            if expanded {
                AssistantMarkdown(text: event.text, streaming: false, onLink: onLink)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.hairline))
            }
        }
    }
}

/// "Memory updated" marker after a turn that saved something.
struct MemoryPill: View {
    let created: Int
    let updated: Int

    var body: some View {
        Label("Memory updated", systemImage: "brain")
            .font(Theme.Text.caption.weight(.medium))
            .foregroundStyle(Theme.muted)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Theme.chatSurface, in: Capsule())
    }
}

/// "Memory recalled · N" — expands to the memories the agent pulled in.
struct MemoryRecallPill: View {
    let entries: [ChatRow.MemoryEntry]
    let fetched: Int
    @State private var expanded = false
    @Environment(\.transcriptReadingInteraction) private var readingInteraction

    private var count: Int { max(entries.count, fetched) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                disclose(readingInteraction) { expanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "brain").font(Theme.Text.micro.weight(.semibold))
                    Text("Memory recalled · \(count)").font(Theme.Text.caption.weight(.medium))
                    if !entries.isEmpty {
                        Image(systemName: "chevron.right")
                            .font(Theme.Text.micro.weight(.bold))
                            .rotationEffect(.degrees(expanded ? 90 : 0))
                    }
                }
                .foregroundStyle(Theme.muted)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Theme.chatSurface, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(entries.isEmpty)

            if expanded {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(entries) { entry in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: entry.scope == "team" ? "person.2" : "person")
                                .font(Theme.Text.micro).foregroundStyle(Theme.muted).padding(.top, 3)
                            Text(entry.label).font(Theme.Text.label).foregroundStyle(Theme.body)
                        }
                    }
                }
                .padding(.top, 8)
                .padding(.leading, 4)
            }
        }
    }
}

/// Pull requests and issues linked to the conversation, pinned under its title.
struct ResourceStrip: View {
    let resources: [SessionResource]
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(resources) { resource in
                    Button { openURL(resource.url) } label: {
                        HStack(spacing: 5) {
                            BrandLogo(name: "logo-\(resource.provider)", size: 12)
                            Text(resource.chip).fontWeight(.medium).foregroundStyle(Theme.heading)
                            Text(resource.state.capitalized).foregroundStyle(tone(resource))
                        }
                        .font(Theme.Text.caption)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Theme.chatSurface, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(resource.title), \(resource.state)")
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.vertical, 6)
        .background(Theme.chatCanvas)
    }

    private func tone(_ resource: SessionResource) -> Color {
        guard resource.provider == "github" else { return Theme.muted }
        switch resource.state {
        case "merged": return Theme.brandText
        case "closed": return .red
        default: return .green
        }
    }
}

/// This person's messages waiting in the session queue, in the order they
/// run, as on Desktop: each can go into the running turn, come back to the
/// composer to edit (tap), or be taken back.
struct QueuedStrip: View {
    struct Item: Identifiable, Equatable {
        let id: String
        let text: String
        let steering: Bool
    }
    let items: [Item]
    var canSteer = false
    var onEdit: (String) -> Void
    var onSteer: (String) -> Void
    var onRemove: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Queued messages · run after the turn ahead")
                .font(Theme.Text.micro)
                .foregroundStyle(Theme.muted)
                .padding(.horizontal, 4)
            ScrollView {
                VStack(spacing: 6) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        row(item, number: index + 1)
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(maxHeight: 136)
            .fixedSize(horizontal: false, vertical: items.count <= 3)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
    }

    private func row(_ item: Item, number: Int) -> some View {
        HStack(spacing: 8) {
            Button { onEdit(item.id) } label: {
                HStack(spacing: 8) {
                    Image(systemName: "text.badge.plus").font(Theme.Text.micro)
                    Text("\(number)").font(Theme.Text.micro).monospacedDigit().foregroundStyle(Theme.muted)
                    Text(item.text).lineLimit(1).font(Theme.Text.label)
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Queued message \(number): \(item.text)")
            .accessibilityHint("Edit in the composer")
            if !item.id.hasPrefix("local.") {
                Button { onSteer(item.id) } label: {
                    Group {
                        if item.steering { ProgressView().controlSize(.mini) }
                        else { Image(systemName: "arrow.turn.down.right").font(Theme.Text.micro.weight(.bold)) }
                    }
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!canSteer || item.steering)
                .opacity(canSteer ? 1 : 0.35)
                .accessibilityLabel("Send into the running turn")
            }
            Button { onRemove(item.id) } label: {
                Image(systemName: "xmark").font(Theme.Text.micro.weight(.bold))
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Take back")
        }
        .foregroundStyle(Theme.body)
        .padding(.leading, 12)
        .padding(.trailing, 4)
        .padding(.vertical, 4)
        .background(Theme.chatSurface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// A teammate's computer that asks its owner first: the message waits for them, or they declined.
struct ShareApprovalStrip: View {
    let wait: ShareApprovalWait
    let computer: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: wait == .pending ? "hourglass" : "nosign")
                .font(Theme.Text.label)
                .foregroundStyle(wait == .pending ? Theme.warning : Color.red)
            Text(wait.message(computer: computer))
                .font(Theme.Text.label)
                .foregroundStyle(Theme.body)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.chatSurface, in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
        .accessibilityElement(children: .combine)
    }
}

#if os(iOS)
/// Whether the system shows the navigation bar's buttons in a side rail (the
/// vertical bar on iPhone Duo) instead of in the bar itself.
private struct BarButtonsInSideRailKey: EnvironmentKey, UITraitBridgedEnvironmentKey {
    static let defaultValue = false

    static func read(from traits: UITraitCollection) -> Bool {
        if #available(iOS 27.1, *) { return traits.verticalBarEdge != .unspecified }
        return false
    }

    static func write(to traits: inout UIMutableTraits, value: Bool) {}
}

extension EnvironmentValues {
    fileprivate var barButtonsInSideRail: Bool { self[BarButtonsInSideRailKey.self] }
}

private extension View {
    /// The bar stays put while the transcript scrolls. Where the system
    /// minimizes it (iPhone Duo), each step resized the transcript and moved
    /// the composer docked under it.
    @ViewBuilder
    func keepsNavigationBar() -> some View {
        if #available(iOS 27.0, *) {
            toolbarMinimizationBehavior(.never, for: .navigationBar)
        } else {
            self
        }
    }
}
#endif
