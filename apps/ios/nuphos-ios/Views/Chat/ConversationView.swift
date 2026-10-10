import SwiftUI

/// The chat screen: transcript rows, activity, approvals, and the composer.
struct ConversationView: View {
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
    @State private var loginRuntime: RuntimeInstance?
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @State private var alwaysAllowTarget: ChatPart.ToolPart?
    @State private var alwaysAllowRule = ""
    @State private var didSendInitial = false
    @Environment(AgentStore.self) private var store
    @State private var archiveError: String?
    @State private var updating = false
    @State private var showRename = false
    @State private var renamedTitle = ""

    private var rows: [ChatRow] { ChatRow.rows(for: session) }

    private func updateReading() {
        ConversationUnread.shared.setReading(onScreen && scenePhase == .active, reader: readerID, team: session.teamId, session: session.sessionId)
    }

    var body: some View {
        Group {
            if !session.loaded || session.awaitingReplay {
                ProgressView().tint(Theme.muted)
            } else if let loadError = session.loadError {
                ContentUnavailableView("Couldn't load this chat", systemImage: "exclamationmark.bubble", description: Text(loadError))
            } else {
                transcript
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.chatCanvas)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
                if !session.queued.isEmpty {
                    QueuedStrip(
                        items: session.queued,
                        onRemove: { session.removeQueued(at: $0) }
                    )
                }
                ChatComposerBar(
                    text: $draft,
                    isStreaming: session.isStreaming,
                    canSend: session.canSubmit,
                    canStop: session.canCancel,
                    sendsDuringTurn: session.isNativeRuntime,
                    canSteer: session.canSteer,
                    allowsAttachments: !session.canSteer,
                    failedSubmission: $session.failedSubmission,
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
        .alert("Rename chat", isPresented: $showRename) {
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
        #endif
        .toolbar {
            ToolbarItem(placement: .principal) { titleBar }
            if !session.isNew {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if let link = SessionLink.url(teamId: session.teamId, sessionId: session.sessionId) {
                            ShareLink(item: link) {
                                Label("Share", systemImage: "square.and.arrow.up")
                            }
                        }
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
                        if session.canManage {
                            Button("Rename", systemImage: "pencil") { renamedTitle = session.title; showRename = true }
                            Button {
                                Task {
                                    updating = true
                                    defer { updating = false }
                                    do {
                                        try await session.setArchived(!session.isArchived)
                                        // Either direction takes the chat out
                                        // of the list it was opened from, so
                                        // stay there rather than on a chat
                                        // that no longer belongs.
                                        dismiss()
                                    } catch { archiveError = error.localizedDescription }
                                }
                            } label: {
                                Label(session.isArchived ? "Restore from archive" : "Archive", systemImage: session.isArchived ? "tray.and.arrow.up" : "archivebox")
                            }
                        }
                    } label: {
                        // The menu has closed by the time the request runs;
                        // this is what shows it was taken. A Label, not a bare
                        // Image: the bar takes it as a native item, so the
                        // whole glass answers, not just the glyph.
                        if updating { ProgressView() } else { Label("Chat options", systemImage: "ellipsis") }
                    }
                    .disabled(updating)
                    .accessibilityLabel("Chat options")
                }
            }
        }
        .alert("Couldn't update chat", isPresented: Binding(get: { archiveError != nil }, set: { if !$0 { archiveError = nil } })) {
            Button("OK") { archiveError = nil }
        } message: {
            Text(archiveError ?? "")
        }
        .sheet(item: $toolDetail) { ToolDetailSheet(part: $0) }
        .sheet(item: $loginRuntime) { runtime in if let team = store.selectedTeam { AgentSetupSheet(team: team, runtime: runtime) } }
        .sheet(item: $planLink) { target in
            NavigationStack {
                PlanDetailView(
                    planId: target.planId,
                    teamId: target.teamId,
                    approve: { plan in try await session.approvePlan(plan.id) },
                    showsChatActions: false
                )
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { planLink = nil }
                    }
                }
            }
            .presentationDetents([.large])
        }
        .alert("Always allow", isPresented: Binding(get: { alwaysAllowTarget != nil }, set: { if !$0 { alwaysAllowTarget = nil } })) {
            TextField("Describe the rule", text: $alwaysAllowRule)
            Button("Allow") {
                if let target = alwaysAllowTarget {
                    session.decide(toolCallId: target.toolCallId, .always(rule: alwaysAllowRule))
                }
                alwaysAllowTarget = nil
            }
            .disabled(alwaysAllowRule.trimmingCharacters(in: .whitespaces).isEmpty)
            Button("Cancel", role: .cancel) { alwaysAllowTarget = nil }
        } message: {
            Text("Commands matching this description will run without asking.")
        }
        .task {
            if session.isNew, let initialPrompt, !didSendInitial {
                didSendInitial = true
                session.send(initialPrompt)
            } else if !session.loaded {
                await session.load()
            }
            #if DEBUG
            // `-approve-plan <id>`: exercise the approval round-trip.
            let args = CommandLine.arguments
            if let i = args.firstIndex(of: "-approve-plan"), i + 1 < args.count, !session.isNew {
                _ = try? await session.approvePlan(args[i + 1])
            }
            #endif
        }
        .task { await session.pollWhileIdle() }
        // New files land while a turn runs; read them once it settles.
        .task(id: "\(session.isStreaming).\(session.messages.count)") {
            if !session.isStreaming { await session.refreshDownloads() }
        }
        .task {
            while !Task.isCancelled {
                session.tickRuntimeClock()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    /// The conversation's title, with the agent that answers in it on a
    /// second, quieter line — where the composer's runtime chip used to be.
    private var titleBar: some View {
        VStack(spacing: 1) {
            Text(session.title)
                .font(Theme.Text.label.weight(.semibold))
                .foregroundStyle(Theme.heading)
                .lineLimit(1)
            if let name = session.runtimeDisplayName {
                HStack(spacing: 4) {
                    RuntimeMark(runtime: session.isNativeRuntime ? session.agentRuntime : nil)
                    Text(name)
                        .font(Theme.Text.micro)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Runtime: \(name)")
            } else if !session.loaded {
                // A chat opened without the list's copy of the runtime — from
                // a plan, say — holds the line rather than growing into it
                // once the detail lands.
                Text(" ").font(Theme.Text.micro).accessibilityHidden(true)
            }
        }
        .frame(maxWidth: 240)
    }

    /// Plan links open the plan here; everything else leaves the app.
    private func open(link url: URL) {
        if let target = PlanLink.target(in: url) {
            planLink = target
        } else {
            openURL(url)
        }
    }

    /// UIKit owns the iOS transcript's layout and reading position.
    @ViewBuilder
    private var transcript: some View {
        #if os(iOS)
        TranscriptList(rows: rows, submittedRowID: session.lastSubmittedRowID, sessionID: session.sessionId) { row in
            AnyView(rowView(row)
                .padding(.horizontal, 16)
                .padding(.bottom, rowSpacing(row)))
        }
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
        case .user, .sending: 22
        case .timestamp: 14
        case .reasoning, .tool, .toolRun, .work, .memory, .memoryRecall, .downloads: 14
        case .activity, .hint: 18
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
            ToolCallRow(
                part: part,
                canDecide: canDecide,
                session: session,
                onOpen: { toolDetail = part },
                onAlwaysAllow: {
                    alwaysAllowRule = part.authorization?["suggestedRule"]?.stringValue ?? ""
                    alwaysAllowTarget = part
                }
            )
        case .toolRun(_, _, let items, let live):
            ToolRunView(items: items, live: live, session: session, onOpen: { toolDetail = $0 }, onAlwaysAllow: { part in
                alwaysAllowRule = part.authorization?["suggestedRule"]?.stringValue ?? ""
                alwaysAllowTarget = part
            })
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
        case .activity(let text):
            ActivityRow(text: text)
        case .sending:
            if let sending = session.sending {
                SendingBubble(submission: sending.submission, progress: sending.progress, onCancel: session.cancelSending)
            }
        case .hint(let id, let text, let isError):
            VStack(alignment: .leading, spacing: 8) {
                HintRow(text: text, isError: isError)
                // The agent this chat runs on, when this user may sign it in again.
                if id == "sign-in", store.selectedTeam?.id == session.teamId,
                   let runtime = store.runtimes.first(where: { $0.id == session.runtimeId ?? session.runtime?.id }), store.canSignIn(runtime) {
                    Button("Sign In") { loginRuntime = runtime }.buttonStyle(.bordered)
                }
            }
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
                Text(text)
                    .font(Theme.Text.body)
                    .lineSpacing(Theme.Text.leading)
                    .foregroundStyle(Theme.heading)
                    .textSelection(.enabled)
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
                Text(submission.text)
                    .font(Theme.Text.body)
                    .lineSpacing(Theme.Text.leading)
                    .foregroundStyle(Theme.heading)
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

    private var count: Int { max(entries.count, fetched) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.spring(response: 0.4, dampingFraction: 0.9)) { expanded.toggle() }
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

            Collapsible(expanded: expanded) {
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

/// Queued messages waiting for the current reply to finish.
struct QueuedStrip: View {
    let items: [String]
    var onRemove: (Int) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(spacing: 6) {
                        Image(systemName: "clock").font(Theme.Text.micro)
                        Text(item).lineLimit(1).font(Theme.Text.label)
                        Button { onRemove(index) } label: {
                            Image(systemName: "xmark").font(Theme.Text.micro.weight(.bold))
                                .contentShape(Rectangle().inset(by: -10))
                        }
                        .buttonStyle(.plain)
                    }
                    .foregroundStyle(Theme.body)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Theme.chatSurface, in: Capsule())
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.bottom, 6)
    }
}
