import SwiftUI

/// A chat: people and agents talking, as the desktop's `ChannelPane` shows it.
/// The conversation's transcript list keeps it at the latest post and docks
/// the composer; posts are bubbles, yours on the right.
struct ChannelView: View {
    @Bindable var channel: ChannelSession

    @Environment(AgentStore.self) private var store
    @Environment(\.openURL) private var openURL
    @Environment(\.horizontalSizeClass) private var sizeClass
    /// Opens a Task over this chat by its id and title: the Bot's own, or one it dispatched.
    var openTask: (String, String) -> Void = { _, _ in }
    @State private var canOpenTask = false
    /// The Bot's details, opened from its name (#2983).
    @State private var detailsOpen = false
    @State private var botSession: ChatSession?
    @State private var draft = ""
    /// The agents typing: those in a turn, as of the last read of this chat. See `inTurn`.
    @State private var typing: [ChannelAgent] = []
    /// Raises the keyboard when a reply is chosen.
    @State private var replyFocus = 0
    /// The post a quote was tapped for: scrolled to and flashed.
    @State private var jump: TranscriptJump?
    @State private var flashed: String?
    /// The Bot's desktop, opened from the header as its Task page opens it.
    @State private var desktop: DesktopSession?
    /// The Bot whose agent is being switched, after it could not reply.
    @State private var switchingBot: ChatSession?
    @State private var switchError: String?

    /// Only an agent's owner can move it to another agent.
    private func owns(_ agentId: String?) -> Bool {
        channel.agents.contains { $0.sessionId == agentId && $0.ownerId == channel.viewerId }
    }

    /// The Bot this is the 1:1 chat of, when its owner can open its desktop now.
    private var desktopBot: String? {
        guard let bot = channel.botId,
              store.conversations.first(where: { $0.sessionId == bot })?.ownsChat == true,
              store.observations.value(team: channel.teamId, session: bot)?.canOpenDesktop == true else { return nil }
        return bot
    }

    /// What the Bot's Tasks are doing, under its name: those the viewer can see.
    private var state: (text: String, waiting: Bool)? {
        channel.botId.flatMap { store.stateLine(under: $0, team: channel.teamId) }
    }

    private func openDetails() { detailsOpen = botSession != nil }

    /// The Bot's details: its card, then what its own Task's summary lists.
    private func details(of bot: ChatSession) -> some View {
        let card = BotDetailsCard(channel: channel, openTask: canOpenTask ? { open(bot.sessionId, title: channel.title) } : nil)
        return AgentSummaryPanel(session: bot, close: { detailsOpen = false }, archive: {}, lead: AnyView(card)) { task in
            open(task.sessionId, title: task.displayTitle)
        }
        .environment(store)
    }

    /// Opens a Task over this chat, so Back returns here.
    private func open(_ task: String, title: String) {
        detailsOpen = false
        openTask(task, title)
    }

    private var rows: [ChatRow] {
        ChannelPost.items(posts: channel.posts, events: channel.events, typing: typing,
                          questions: channel.questions.list)
            .map { ChatRow.channel(id: $0.id, item: $0.item) }
    }

    /// The chat's agents in a turn that answers this chat, as far as this device
    /// has seen their runtimes. A turn about anything else, such as a direct
    /// message in the agent's own conversation, shows no dots here.
    /// Seen from the conversation list's poll, not this chat's, so it only
    /// takes effect (`typing`) after a read of the chat that started later. An
    /// agent posts before its turn ends, so its reply and the end of its dots
    /// arrive in the same update, never the dots' end first. A post during the
    /// turn shows above the dots: the agent is still working.
    private var inTurn: [ChannelAgent] {
        channel.agents.filter { agent in
            store.observations.value(team: channel.teamId, session: agent.sessionId)?
                .typing(in: channel.channelId) == true
        }
    }

    var body: some View {
        // Wide, the Bot's details sit beside the live chat, closed by their ✕;
        // compact, they come up as a sheet.
        HStack(spacing: 0) {
            transcript
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.chatCanvas)
            if sizeClass == .regular, detailsOpen, let botSession {
                Divider()
                details(of: botSession).frame(width: 340)
            }
        }
            .sheet(isPresented: Binding(get: { sizeClass != .regular && detailsOpen }, set: { detailsOpen = $0 })) {
                if let botSession {
                    details(of: botSession).presentationDetents([.large]).presentationDragIndicator(.visible)
                }
            }
            .navigationTitle(channel.title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            .keepsNavigationBar()
            #endif
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Button(action: openDetails) {
                        HStack(spacing: 8) {
                            ChatIcon(faces: channel.faces, title: channel.title, size: 24)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(channel.title)
                                    .font(Theme.Text.label.weight(.semibold))
                                    .foregroundStyle(Theme.heading)
                                    .lineLimit(1)
                                if let state {
                                    Text(state.text)
                                        .font(.caption2)
                                        .foregroundStyle(state.waiting ? Theme.attention : Theme.muted)
                                        .lineLimit(1)
                                }
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(channel.botId == nil)
                    .accessibilityIdentifier("bot-details-entry")
                }
                if let bot = desktopBot {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            desktop = DesktopSession(teamId: channel.teamId, sessionId: bot, token: store.token)
                        } label: {
                            LucideIcon("monitor")
                        }
                        .accessibilityLabel("Desktop")
                        .accessibilityIdentifier("chat.desktop")
                    }
                }
            }
            .task(id: channel.botId) {
                canOpenTask = false
                // Made before the details open: a sheet shown in the same update that
                // sets what its content reads comes up empty.
                botSession = channel.botId.map { store.session(sessionId: $0, title: channel.title, teamId: channel.teamId) }
                guard let bot = channel.botId else { return }
                if channel.agents.contains(where: { $0.sessionId == bot && $0.ownerId == channel.viewerId }) {
                    canOpenTask = true
                } else {
                    // Channel membership alone does not grant session access.
                    let detail = try? await NuphosAPI.conversationDetail(token: store.token, teamId: channel.teamId, sessionId: bot, tail: 1, displayed: false)
                    guard !Task.isCancelled, channel.botId == bot else { return }
                    canOpenTask = detail != nil
                }
            }
            .desktop($desktop)
            .sheet(isPresented: Binding(get: { switchingBot != nil }, set: { if !$0 { switchingBot = nil } })) {
                RuntimePickerSheet(session: switchingBot) { runtime in
                    guard let bot = switchingBot else { return }
                    Task {
                        do { try await bot.move(to: runtime); switchingBot = nil; await store.reload() }
                        catch { switchError = error.localizedDescription }
                    }
                }
            }
            .alert("Couldn't switch runtime", isPresented: Binding(
                get: { switchError != nil }, set: { if !$0 { switchError = nil } })) {
                Button("OK") { switchError = nil }
            } message: {
                Text(switchError ?? "")
            }
            .onAppear {
                Analytics.shared.screen("channel", teamID: channel.teamId)
                if draft.isEmpty { draft = ComposerDrafts.text(team: channel.teamId, session: channel.channelId, identity: store.token) }
            }
            .onChange(of: inTurn.map(\.id), initial: true) {
                guard inTurn.map(\.id) != typing.map(\.id) else { return }
                // Not the view's own task: SwiftUI can cancel those while the
                // view stays on screen (#1440), which would leave the dots stale.
                Task {
                    await channel.refresh(force: true)
                    typing = inTurn
                }
            }
            .onChange(of: channel.loaded ? channel.posts.count : -1, initial: true) { showPendingPost() }
            .onChange(of: draft) { _, text in ComposerDrafts.set(text, team: channel.teamId, session: channel.channelId, identity: store.token) }
            .alert("Couldn't send the message", isPresented: Binding(
                get: { channel.sendError != nil }, set: { if !$0 { channel.sendError = nil } })) {
                Button("OK") { channel.sendError = nil }
            } message: {
                Text(channel.sendError ?? "")
            }
            #if DEBUG
            // `-channel-send "<text>"`: a post a few seconds after opening, to see it arrive.
            .task {
                let args = CommandLine.arguments
                guard let i = args.firstIndex(of: "-channel-send"), i + 1 < args.count else { return }
                try? await Task.sleep(for: .seconds(4))
                channel.send(ComposerSubmission(text: args[i + 1], attachments: []))
            }
            #endif
    }

    @ViewBuilder
    private var placeholder: some View {
        if !channel.loaded {
            ProgressView().tint(Theme.muted)
        } else if let error = channel.loadError {
            ContentUnavailableView("Couldn't load this chat", image: "lucide-message-circle-warning", description: Text(error))
        } else if channel.posts.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                ChatIcon(faces: channel.faces, title: channel.title, size: 44)
                Text(channel.title).font(.title3.weight(.semibold)).foregroundStyle(Theme.heading)
                Text("Everyone here sees each message and decides for themselves whether to reply, as in any group chat.")
                    .font(Theme.Text.secondary)
                    .foregroundStyle(Theme.body)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("chat.empty")
            .padding(24)
            // Centered, as the other placeholders: the list runs under the navigation bar.
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }

    private var composer: some View {
        VStack(spacing: 6) {
            if let reply = channel.replying { ReplyChip(reply: reply) { channel.replying = nil } }
            ChatComposerBar(
                text: $draft,
                canSend: channel.loaded && !channel.readOnly,
                editRequest: $channel.unsent,
                // As in a Task: `@` offers the viewer's other Bots and tasks, as their links.
                mentions: MentionSource(
                    teamId: channel.teamId,
                    sessions: store.mentionableSessions(teamId: channel.teamId, excluding: channel.botId),
                    refresh: { await store.loadMentionableSessions(teamId: channel.teamId) }
                ),
                voiceTeamId: channel.teamId,
                recipient: channel.title,
                focusRequest: replyFocus,
                onSend: { channel.send($0) },
                controls: { EmptyView() }
            )
        }
    }

    private func reply(to post: ChannelPost) {
        channel.replying = post.asReply
        replyFocus += 1
    }

    /// Scrolls to a quoted post, if it is loaded, and flashes it.
    private func show(_ reply: ChannelReply) {
        if let id = reply.id { show(post: id) }
    }

    /// Opened from a wake-up's line: once the chat has loaded, it goes to the post that
    /// line named. A post no longer loaded leaves it at its latest post.
    private func showPendingPost() {
        guard channel.loaded, let id = ChannelPostJump.pending.removeValue(forKey: channel.channelId) else { return }
        show(post: id)
    }

    private func show(post id: String) {
        guard channel.posts.contains(where: { $0.id == id }) else { return }
        jump = TranscriptJump(rowID: "post.\(id)")
        flashed = id
        Task {
            try? await Task.sleep(for: .milliseconds(900))
            if flashed == id { flashed = nil }
        }
    }

    @ViewBuilder
    private var transcript: some View {
        #if os(iOS)
        TranscriptList(rows: channel.loaded && channel.loadError == nil ? rows : [], submittedRowID: channel.lastSubmittedRowID,
                       sessionID: channel.channelId,
                       composer: AnyView(composer.environment(store).readableWidth()), placeholder: AnyView(placeholder),
                       animatesArrivals: true, jump: jump, swipeAction: replyAction) { row in
            AnyView(rowView(row)
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
                .readableWidth())
        }
        .ignoresSafeArea(.all, edges: .bottom)
        .ignoresSafeArea(.container, edges: .top)
        #else
        ScrollView {
            LazyVStack(spacing: 12) { ForEach(rows) { rowView($0) } }.padding(16)
        }
        .defaultScrollAnchor(.bottom)
        .safeAreaInset(edge: .bottom) { composer }
        #endif
    }

    /// Swiping a post right replies to it, where the viewer can post.
    private func replyAction(_ row: ChatRow) -> (() -> Void)? {
        guard case .channel(_, .post(let post, _)) = row, !channel.readOnly, !post.sending else { return nil }
        return { reply(to: post) }
    }

    @ViewBuilder
    private func rowView(_ row: ChatRow) -> some View {
        if case .channel(_, let item) = row {
            switch item {
            case .time(let date):
                TimestampLabel(date: date)
            case .post(let post, let first):
                ChannelPostRow(post: post, first: first, mine: post.isMine(viewerId: channel.viewerId),
                               attachments: channel.sendingAttachments[post.id] ?? [], channel: channel,
                               onLink: open(link:),
                               flashed: flashed == post.id,
                               onReply: channel.readOnly || post.sending ? nil : { reply(to: post) },
                               onQuote: show)
            case .paused(let text):
                PausedLine(text: text)
            case .answeredInInbox(let post):
                let mine = post.isMine(viewerId: channel.viewerId)
                HStack(spacing: 4) {
                    LucideIcon("inbox", size: 10)
                    Text("Answered in Inbox")
                }
                .font(.caption2)
                .foregroundStyle(Theme.faint)
                .padding(.horizontal, 4)
                .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
                // Tucked under the answer it follows, inside that row's bottom spacing.
                .padding(.top, -8)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("channel.answeredInInbox")
            case .record(let text):
                Text(text)
                    .font(Theme.Text.caption)
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .accessibilityIdentifier("channel.decisionRecord")
            case .replyFailed(let event, let actionable):
                ReplyFailedLine(
                    event: event,
                    onVerify: actionable && owns(event.agentId) ? event.verifyUrl.map { url in { openURL(url) } } : nil,
                    onSwitch: actionable && owns(event.agentId) && ["usage_limit", "auth", "offline"].contains(event.cause ?? "")
                        ? { if let id = event.agentId { switchingBot = store.session(sessionId: id, title: channel.title, teamId: channel.teamId) } }
                        : nil,
                    onRetry: actionable ? event.agentId.map { id in { channel.wake(agent: id) } } : nil)
            case .typing(let agents):
                TypingRow(agents: agents)
            case .question(let question):
                BotQuestionCard(
                    question: question,
                    // The Bot's own questions are this chat's; only an agent under it is named.
                    showsFrom: question.sessionId != channel.botId,
                    onOpen: { open(link: question.link(team: channel.teamId)) },
                    teamId: channel.teamId,
                    questions: channel.questions,
                    onAnswer: { channel.answer(question, with: $0) },
                    onDismiss: { channel.dismiss(question) },
                    onLink: open(link:))
            }
        }
    }

    /// Nuphos pages open in the app, as a conversation's links do; anything else leaves.
    private func open(link url: URL) {
        if !PushNotifications.shared.open(url) { openURL(url) }
    }
}

/// A row to bring to the middle of the transcript, once per request.
/// The post a channel opens at, by channel: set just before a wake-up's line opens it.
@MainActor
enum ChannelPostJump {
    static var pending: [String: String] = [:]
}

struct TranscriptJump: Equatable {
    let rowID: String
    var nonce = UUID()
}

/// A chat's icon: the one other member's face, or up to three members
/// clustered as in the design system. A chat with nobody else shows its
/// title's initials.
struct ChatIcon: View {
    /// Where a group's faces sit in a 36pt box, whoever spoke last largest:
    /// left, top and size.
    static let cluster: [(x: CGFloat, y: CGFloat, size: CGFloat)] = [(0, 0, 24), (18, 12, 18), (5, 22, 14)]

    let faces: [ChatFace]
    let title: String
    var size: CGFloat = 22

    var body: some View {
        Group {
            if faces.count >= 2 {
                let scale = size / 36
                ZStack(alignment: .topLeading) {
                    ForEach(Array(faces.prefix(Self.cluster.count).enumerated()), id: \.element.id) { index, member in
                        let slot = Self.cluster[index]
                        // Each face is ringed by whatever lies behind the icon: its ring
                        // cuts the faces beneath it out rather than painting a color.
                        Circle()
                            .frame(width: (slot.size + 4) * scale, height: (slot.size + 4) * scale)
                            .offset(x: (slot.x - 2) * scale, y: (slot.y - 2) * scale)
                            .blendMode(.destinationOut)
                        face(member, size: slot.size * scale, showBadge: false)
                            .background(Theme.sunken, in: Circle())
                            .clipShape(Circle())
                            .offset(x: slot.x * scale, y: slot.y * scale)
                    }
                }
                .frame(width: size, height: size, alignment: .topLeading)
                .compositingGroup()
            } else if let only = faces.first {
                face(only, size: size)
            } else {
                person(id: "", name: title, avatarURL: nil, size: size)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private func face(_ face: ChatFace, size: CGFloat, showBadge: Bool = true) -> some View {
        if face.agent != nil {
            AgentAvatar(agentId: face.id, runtime: face.agent?.provider, size: size, showBadge: showBadge)
        } else {
            person(id: face.id, name: face.name, avatarURL: face.avatarURL, size: size)
        }
    }

    private func person(id: String, name: String, avatarURL: String?, size: CGFloat) -> some View {
        AvatarView(user: NuphosUser(id: id, email: "", name: name, username: "", avatarURL: avatarURL ?? ""), size: size)
    }
}

/// One post: yours on the right, everyone else's on the left under their
/// avatar and name, shown once per run. A person's files show above their
/// words and an agent's below, as in a conversation.
private struct ChannelPostRow: View {
    @Environment(AgentStore.self) private var store
    let post: ChannelPost
    let first: Bool
    let mine: Bool
    let attachments: [ComposerAttachment]
    /// The chat: its file groups read so far, and fresh links for them. Read
    /// here, not passed in, so a group read after the row was drawn shows.
    let channel: ChannelSession
    let onLink: (URL) -> Void
    /// Briefly highlighted: a quote of it was tapped.
    var flashed = false
    /// The long-press menu and VoiceOver reply with it; nil where the viewer cannot post.
    var onReply: (() -> Void)?
    var onQuote: (ChannelReply) -> Void = { _ in }

    @State private var selectionRequest = 0

    private static let avatar: CGFloat = 20

    /// The groups' files when the chat has read them all; else the card reads them.
    private func read(_ groupIds: [String]) -> [TransferDownloadGroup.File]? {
        let groups = groupIds.compactMap { channel.files[$0] }
        return groups.count == groupIds.count ? groups.flatMap { $0 } : nil
    }

    var body: some View {
        HStack(spacing: 0) {
            if mine { Spacer(minLength: 48) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
                if first, !mine { header }
                if !post.uploads.isEmpty {
                    TransferCard(groupIds: post.uploads.map(\.groupId), fromUser: mine,
                                 names: post.uploads.flatMap { $0.files.map(\.fileName) },
                                 files: read(post.uploads.map(\.groupId)), resolve: channel.transferGroup)
                }
                if !attachments.isEmpty { localAttachments }
                if !post.text.isEmpty || post.replyTo != nil { bubble }
                if !post.downloads.isEmpty {
                    TransferCard(groupIds: post.downloads, fromUser: false, files: read(post.downloads), resolve: channel.transferGroup)
                }
            }
            .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: 18, style: .continuous))
            .contextMenu {
                if let onReply {
                    DesignButton("Reply", image: "lucide-undo-2", action: onReply)
                }
                #if canImport(UIKit)
                if !post.text.isEmpty {
                    DesignButton("Select Text", image: "lucide-text-cursor") { selectionRequest += 1 }
                    DesignButton("Copy", image: "lucide-copy") { UIPasteboard.general.string = post.text }
                }
                #endif
            }
            if !mine { Spacer(minLength: 48) }
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .accessibilityElement(children: .contain)
        .accessibilityActions {
            if let onReply { Button("Reply", action: onReply) }
            if !post.text.isEmpty { Button("Select Text") { selectionRequest += 1 } }
        }
    }

    /// The post this one answers, at the top of its bubble; tapping it goes there.
    private func quote(_ reply: ChannelReply) -> some View {
        Button { onQuote(reply) } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(reply.authorName).fontWeight(.medium).foregroundStyle(Theme.body)
                Text(reply.text).foregroundStyle(Theme.muted)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            .font(Theme.Text.caption)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .frame(maxWidth: 240, alignment: .leading)
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, -4)
        .accessibilityLabel("Replying to \(reply.authorName): \(reply.text)")
        .accessibilityIdentifier("channel.quote")
    }

    private var header: some View {
        HStack(spacing: 6) {
            if post.isAgent {
                AgentAvatar(agentId: post.senderId, runtime: post.runtime, size: Self.avatar)
            } else {
                AvatarView(user: NuphosUser(id: post.senderId, email: "", name: post.name, username: "",
                                            avatarURL: post.avatar?.absoluteString ?? ""), size: Self.avatar)
            }
            Text(post.name).font(Theme.Text.caption.weight(.medium)).foregroundStyle(Theme.body).lineLimit(1)
            if post.isAgent {
                Text("Bot")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(Theme.bubble, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
            }
        }
        .padding(.horizontal, 4)
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let reply = post.replyTo { quote(reply) }
            if !post.text.isEmpty {
                AssistantMarkdown(text: SessionMention.named(post.text) { store.title(ofSession: $0) }, theme: AssistantMarkdown.bubbleTheme, keepsLineBreaks: true, selectionRequest: selectionRequest, onLink: onLink)
            }
        }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(flashed ? Theme.brand.opacity(0.3) : mine ? Theme.brand.opacity(0.14) : Theme.sunken,
                        in: UnevenRoundedRectangle(cornerRadii: .init(
                            topLeading: !mine && first ? 6 : 18, bottomLeading: 18,
                            bottomTrailing: 18, topTrailing: mine && first ? 6 : 18), style: .continuous))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("channel.bubble")
    }

    /// The photos and files of a post still on its way, from the device.
    private var localAttachments: some View {
        HStack(spacing: 6) {
            ForEach(attachments.prefix(4)) { attachment in
                AttachmentPreview(attachment: attachment)
                    .frame(width: 84, height: 84)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }
}

/// The loop guard stopped agents answering agents: a line on the timeline.
private struct PausedLine: View {
    let text: String

    var body: some View {
        HStack(spacing: 6) {
            LucideIcon("pause").font(.system(size: 9)).foregroundStyle(Theme.warning)
            Text(text).font(Theme.Text.caption).foregroundStyle(Theme.body)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .overlay(Capsule().strokeBorder(Theme.hairline))
        .frame(maxWidth: .infinity)
    }
}

/// An agent could not reply: what happened and why, when its usage returns, and the fixes: Verify, Switch runtime, Retry.
private struct ReplyFailedLine: View {
    let event: AgentConversationDetail.TimelineEvent
    var onVerify: (() -> Void)?
    var onSwitch: (() -> Void)?
    var onRetry: (() -> Void)?

    private var resets: String? {
        guard event.cause == "usage_limit", let date = event.resetsAt, date > .now else { return nil }
        return "Usage returns " + date.formatted(.dateTime.weekday(.abbreviated).hour().minute()) + "."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                LucideIcon("circle-alert").font(.system(size: 11)).foregroundStyle(Theme.warning)
                Text([event.text, resets].compactMap(\.self).joined(separator: " "))
                    .font(Theme.Text.caption).foregroundStyle(Theme.body)
            }
            if onVerify != nil || onSwitch != nil || onRetry != nil {
                HStack(spacing: 8) {
                    if let onVerify {
                        Button("Verify with Anthropic", action: onVerify).buttonStyle(.bordered).accessibilityIdentifier("chat.verifyAccount")
                    }
                    if let onSwitch {
                        Button("Switch runtime", action: onSwitch).buttonStyle(.bordered).accessibilityIdentifier("chat.switchAgent")
                    }
                    if let onRetry {
                        Button("Retry", action: onRetry).buttonStyle(.borderless).accessibilityIdentifier("chat.retryReply")
                    }
                }
                .font(Theme.Text.caption)
                .padding(.leading, 17)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline))
        .frame(maxWidth: .infinity)
    }
}

/// iMessage-style dots for each agent in a turn.
private struct TypingRow: View {
    let agents: [ChannelAgent]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The bubble grows from its tail as it comes in; the row itself fades in.
    @State private var shown = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(agents) { agent in
                HStack(alignment: .bottom, spacing: 8) {
                    AgentAvatar(agentId: agent.sessionId, runtime: agent.provider, size: 28)
                    TypingDots()
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .background(Theme.sunken, in: UnevenRoundedRectangle(cornerRadii: .init(
                            topLeading: 18, bottomLeading: 6, bottomTrailing: 18, topTrailing: 18), style: .continuous))
                        .scaleEffect(shown || reduceMotion ? 1 : 0.5, anchor: .bottomLeading)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(agent.title) is thinking")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { withAnimation(.spring(duration: 0.3, bounce: 0.25)) { shown = true } }
    }
}

/// Three dots that brighten in a continuous wave, every frame. Read from the
/// clock, so a row drawn again picks the wave up where it is.
struct TypingDots: View {
    var size: CGFloat = 7
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            let time = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: size * 5 / 7) {
                ForEach(0..<3) { index in
                    // 0 to 1 and back, each dot a sixth of the 1.2 s cycle after the last.
                    let level = reduceMotion ? 0.5 : max(0, sin(2 * .pi * (time / 1.2 - Double(index) / 6)))
                    Circle()
                        .fill(Theme.muted)
                        .frame(width: size, height: size)
                        .opacity(0.35 + 0.65 * level)
                        .scaleEffect(0.85 + 0.15 * level)
                }
            }
        }
    }
}

/// What the next message answers, above the composer: who, then the quote on up
/// to two lines, as the sent reply will show it; × cancels.
struct ReplyChip: View {
    let reply: ChannelReply
    let onCancel: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            LucideIcon("undo-2").font(.system(size: 12)).foregroundStyle(Theme.muted)
            VStack(alignment: .leading, spacing: 2) {
                Text("Replying to \(reply.authorName)").foregroundStyle(Theme.body).fontWeight(.medium)
                    .lineLimit(1)
                Text(reply.text).foregroundStyle(Theme.muted)
                    .lineLimit(2)
                    .accessibilityIdentifier("channel.replyChip.text")
            }
            .font(Theme.Text.caption)
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: onCancel) {
                LucideIcon("circle-x").font(.system(size: 17)).foregroundStyle(Theme.muted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cancel reply")
        }
        .padding(.leading, 12)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .background(Theme.sunken, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.horizontal, 16)
    }
}
