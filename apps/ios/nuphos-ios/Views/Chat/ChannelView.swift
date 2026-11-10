import SwiftUI

/// A chat: people and agents talking, as the desktop's `ChannelPane` shows it.
/// The conversation's transcript list keeps it at the latest post and docks
/// the composer; posts are bubbles, yours on the right.
struct ChannelView: View {
    @Bindable var channel: ChannelSession

    @Environment(AgentStore.self) private var store
    @Environment(\.openURL) private var openURL
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

    /// The Bot this is the 1:1 chat of, when its owner can open its desktop now.
    private var desktopBot: String? {
        guard let bot = channel.faces.botId,
              store.conversations.first(where: { $0.sessionId == bot })?.ownsChat == true,
              store.observations.value(team: channel.teamId, session: bot)?.canOpenDesktop == true else { return nil }
        return bot
    }

    private var rows: [ChatRow] {
        (ChannelPost.items(posts: channel.posts, events: channel.events, typing: typing)
            + channel.questions.list.map { (id: "question.\($0.id)", item: ChannelItem.question($0)) })
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
        transcript
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.chatCanvas)
            .navigationTitle(channel.title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            .keepsNavigationBar()
            #endif
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: 8) {
                        ChatIcon(faces: channel.faces, title: channel.title, size: 24)
                        Text(channel.title)
                            .font(Theme.Text.label.weight(.semibold))
                            .foregroundStyle(Theme.heading)
                            .lineLimit(1)
                    }
                }
                if let bot = desktopBot {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            desktop = DesktopSession(teamId: channel.teamId, sessionId: bot, token: store.token)
                        } label: {
                            Image(systemName: "display")
                        }
                        .accessibilityLabel("Desktop")
                        .accessibilityIdentifier("chat.desktop")
                    }
                }
            }
            .desktop($desktop)
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
            ContentUnavailableView("Couldn't load this chat", systemImage: "exclamationmark.bubble", description: Text(error))
        } else if channel.posts.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                ChatIcon(faces: channel.faces, title: channel.title, size: 44)
                Text(channel.title).font(.title3.weight(.semibold)).foregroundStyle(Theme.heading)
                Text("Everyone here sees each message and decides for themselves whether to reply, as in any group chat.")
                    .font(Theme.Text.secondary)
                    .foregroundStyle(Theme.body)
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private var composer: some View {
        VStack(spacing: 6) {
            if let reply = channel.replying { replyChip(reply) }
            ChatComposerBar(
                text: $draft,
                canSend: channel.loaded && !channel.readOnly,
                editRequest: $channel.unsent,
                voiceTeamId: channel.teamId,
                recipient: channel.title,
                focusRequest: replyFocus,
                onSend: { channel.send($0) },
                controls: { EmptyView() }
            )
        }
    }

    /// The post the next one answers, above the composer; × cancels.
    private func replyChip(_ reply: ChannelReply) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "arrowshape.turn.up.left.fill").font(.system(size: 12)).foregroundStyle(Theme.muted)
            (Text("Replying to \(reply.authorName) ").foregroundStyle(Theme.body).fontWeight(.medium)
                + Text(reply.text).foregroundStyle(Theme.muted))
                .font(Theme.Text.caption)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button { channel.replying = nil } label: {
                Image(systemName: "xmark.circle.fill").font(.system(size: 17)).foregroundStyle(Theme.muted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cancel reply")
        }
        .padding(.leading, 12)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .background(Theme.chatSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.horizontal, 16)
    }

    private func reply(to post: ChannelPost) {
        channel.replying = post.asReply
        replyFocus += 1
    }

    /// Scrolls to a quoted post, if it is loaded, and flashes it.
    private func show(_ reply: ChannelReply) {
        guard let id = reply.id, channel.posts.contains(where: { $0.id == id }) else { return }
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
                               attachments: channel.sendingAttachments[post.id] ?? [], files: channel.files,
                               resolve: channel.transferGroup, onLink: open(link:),
                               flashed: flashed == post.id,
                               onReply: channel.readOnly || post.sending ? nil : { reply(to: post) },
                               onQuote: show)
            case .paused(let text):
                PausedLine(text: text)
            case .typing(let agents):
                TypingRow(agents: agents)
            case .question(let question):
                BotQuestionCard(
                    question: question,
                    // The Bot's own questions are this chat's; only an agent under it is named.
                    showsFrom: question.sessionId != channel.faces.botId,
                    onOpen: { open(link: question.link(team: channel.teamId)) },
                    onAnswer: { channel.answer(question, with: $0) },
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
struct TranscriptJump: Equatable {
    let rowID: String
    var nonce = UUID()
}

/// A chat's icon, as iMessage draws one: the one other member's face, or two
/// overlapping, whoever spoke last in front. A chat with nobody else shows
/// its title's initials.
struct ChatIcon: View {
    let faces: [ChatFace]
    let title: String
    var size: CGFloat = 22

    var body: some View {
        Group {
            if faces.count >= 2 {
                let small = (size * 0.72).rounded()
                ZStack {
                    face(faces[1], size: small).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    face(faces[0], size: small)
                        .padding(1.5)
                        .background(Theme.chatCanvas, in: Circle())
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                }
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
    private func face(_ face: ChatFace, size: CGFloat) -> some View {
        if face.agent != nil {
            AgentAvatar(agentId: face.id, runtime: face.agent?.provider, size: size)
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
    let post: ChannelPost
    let first: Bool
    let mine: Bool
    let attachments: [ComposerAttachment]
    /// The chat's file groups, already read.
    let files: [String: [TransferDownloadGroup.File]]
    let resolve: (String) async throws -> TransferDownloadGroup
    let onLink: (URL) -> Void
    /// Briefly highlighted: a quote of it was tapped.
    var flashed = false
    /// The long-press menu and VoiceOver reply with it; nil where the viewer cannot post.
    var onReply: (() -> Void)?
    var onQuote: (ChannelReply) -> Void = { _ in }

    private static let avatar: CGFloat = 20

    /// The groups' files when the chat has read them all; else the card reads them.
    private func read(_ groupIds: [String]) -> [TransferDownloadGroup.File]? {
        let groups = groupIds.compactMap { files[$0] }
        return groups.count == groupIds.count ? groups.flatMap { $0 } : nil
    }

    var body: some View {
        HStack(spacing: 0) {
            if mine { Spacer(minLength: 48) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
                if first, !mine { header }
                if let reply = post.replyTo { quote(reply) }
                if !post.uploads.isEmpty {
                    TransferCard(groupIds: post.uploads.map(\.groupId), fromUser: mine,
                                 names: post.uploads.flatMap { $0.files.map(\.fileName) },
                                 files: read(post.uploads.map(\.groupId)), resolve: resolve)
                }
                if !attachments.isEmpty { localAttachments }
                if !post.text.isEmpty { bubble }
                if !post.downloads.isEmpty {
                    TransferCard(groupIds: post.downloads, fromUser: false, files: read(post.downloads), resolve: resolve)
                }
            }
            if !mine { Spacer(minLength: 48) }
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .contextMenu {
            if let onReply {
                Button("Reply", systemImage: "arrowshape.turn.up.left", action: onReply)
            }
            #if canImport(UIKit)
            if !post.text.isEmpty {
                Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = post.text }
            }
            #endif
        }
        .accessibilityElement(children: .contain)
        .accessibilityActions {
            if let onReply { Button("Reply", action: onReply) }
        }
    }

    /// The post this one answers; tapping it goes there.
    private func quote(_ reply: ChannelReply) -> some View {
        Button { onQuote(reply) } label: {
            (Text(reply.authorName).fontWeight(.medium).foregroundStyle(Theme.body)
                + Text(" " + reply.text).foregroundStyle(Theme.muted))
                .font(Theme.Text.caption)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .padding(.leading, 8)
                .overlay(alignment: .leading) { Capsule().fill(Theme.hairline).frame(width: 2) }
                .padding(.horizontal, 4)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Replying to \(reply.authorName): \(reply.text)")
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
                Text("Agent")
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
        AssistantMarkdown(text: post.text, theme: AssistantMarkdown.bubbleTheme, keepsLineBreaks: true, onLink: onLink)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(flashed ? Theme.brand.opacity(0.3) : mine ? Theme.brand.opacity(0.14) : Theme.chatSurface,
                        in: UnevenRoundedRectangle(cornerRadii: .init(
                            topLeading: !mine && first ? 6 : 18, bottomLeading: 18,
                            bottomTrailing: 18, topTrailing: mine && first ? 6 : 18), style: .continuous))
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
            Image(systemName: "pause.fill").font(.system(size: 9)).foregroundStyle(Theme.warning)
            Text(text).font(Theme.Text.caption).foregroundStyle(Theme.body)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .overlay(Capsule().strokeBorder(Theme.hairline))
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
                    AgentAvatar(agentId: agent.sessionId, runtime: nil, size: 28)
                    TypingDots()
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .background(Theme.chatSurface, in: UnevenRoundedRectangle(cornerRadii: .init(
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
private struct TypingDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            let time = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 5) {
                ForEach(0..<3) { index in
                    // 0 to 1 and back, each dot a sixth of the 1.2 s cycle after the last.
                    let level = reduceMotion ? 0.5 : max(0, sin(2 * .pi * (time / 1.2 - Double(index) / 6)))
                    Circle()
                        .fill(Theme.muted)
                        .frame(width: 7, height: 7)
                        .opacity(0.35 + 0.65 * level)
                        .scaleEffect(0.85 + 0.15 * level)
                }
            }
        }
    }
}
