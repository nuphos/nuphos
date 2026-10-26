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
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @State private var didSendInitial = false
    @Environment(AgentStore.self) private var store
    @State private var archiveError: String?
    @State private var updating = false
    @State private var showRename = false
    @State private var renamedTitle = ""
    @State private var showRuntimes = false
    @State private var showShare = false
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
            #if canImport(UIKit)
            // UIKit gives the list back the focus it had when this chat opened,
            // raising a keyboard over a composer it does not lift. Only a chat
            // that has really gone runs this; a cancelled back swipe does not.
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            #endif
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
                        if session.ownsChat {
                            Button("Rename", systemImage: "pencil") { renamedTitle = session.title; showRename = true }
                        }
                        if session.canManage {
                            Button("Switch runtime", systemImage: "arrow.left.arrow.right") { showRuntimes = true }
                                .disabled(session.isStreaming)
                            Button {
                                Task {
                                    updating = true
                                    defer { updating = false }
                                    do {
                                        let archiving = !session.isArchived
                                        try await session.setArchived(archiving)
                                        // An archived chat leaves the list,
                                        // so go back to it; a restored one
                                        // rejoins it.
                                        if archiving {
                                            store.removeFromList(session.sessionId)
                                            dismiss()
                                        } else {
                                            await store.reload()
                                        }
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
                        if updating { ProgressView() } else { Label("Agent options", systemImage: "ellipsis") }
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
        .sheet(isPresented: $showShare) { ShareSessionSheet(session: session) }
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
            await session.refreshResources()
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
        HStack(spacing: 8) {
            AgentAvatar(agentId: session.sessionId, runtime: session.agentRuntime)
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
                    Text(" ").font(Theme.Text.micro).accessibilityHidden(true)
                }
            }
        }
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

    /// The composer, with any queued messages above it.
    private var composer: some View {
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
        .ignoresSafeArea(.all, edges: .bottom)
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
