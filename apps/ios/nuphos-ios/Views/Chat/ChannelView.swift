import SwiftUI

/// A chat: people and agents talking, as the desktop's `ChannelPane` shows it.
/// The conversation's transcript list keeps it at the latest post and docks
/// the composer; posts are bubbles, yours on the right.
struct ChannelView: View {
    @Bindable var channel: ChannelSession

    @Environment(AgentStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @State private var readerID = UUID()
    @State private var onScreen = false
    @State private var draft = ""

    private var rows: [ChatRow] {
        ChannelPost.items(posts: channel.posts, events: channel.events, typing: typing)
            .map { ChatRow.channel(id: $0.id, item: $0.item) }
    }

    /// The chat's agents in a turn, as far as this device has seen their runtimes.
    private var typing: [ChannelAgent] {
        channel.agents.filter { agent in
            RuntimeObservations.shared.value(team: channel.teamId, session: agent.sessionId)?.turnActive == true
                || store.conversations.first { $0.sessionId == agent.sessionId }?.activeRun != nil
        }
    }

    private func updateReading() {
        ConversationUnread.shared.setReading(onScreen && scenePhase == .active, reader: readerID,
                                             team: channel.teamId, session: channel.channelId)
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
                        ChannelMark(size: 24)
                        Text(channel.title)
                            .font(Theme.Text.label.weight(.semibold))
                            .foregroundStyle(Theme.heading)
                            .lineLimit(1)
                    }
                }
            }
            .onAppear {
                Analytics.shared.screen("channel", teamID: channel.teamId)
                onScreen = true
                updateReading()
                if draft.isEmpty { draft = ComposerDrafts.text(team: channel.teamId, session: channel.channelId) }
            }
            .onDisappear {
                onScreen = false
                updateReading()
            }
            .onChange(of: scenePhase) { _, _ in updateReading() }
            .onChange(of: draft) { _, text in ComposerDrafts.set(text, team: channel.teamId, session: channel.channelId) }
            .alert("Couldn't send the message", isPresented: Binding(
                get: { channel.sendError != nil }, set: { if !$0 { channel.sendError = nil } })) {
                Button("OK") { channel.sendError = nil }
            } message: {
                Text(channel.sendError ?? "")
            }
            .task { await channel.poll() }
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
                ChannelMark(size: 44)
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
        ChatComposerBar(
            text: $draft,
            canSend: channel.loaded && !channel.readOnly,
            editRequest: $channel.unsent,
            voiceTeamId: channel.teamId,
            recipient: "#\(channel.title)",
            onSend: { channel.send($0) },
            controls: { EmptyView() }
        )
    }

    @ViewBuilder
    private var transcript: some View {
        #if os(iOS)
        TranscriptList(rows: channel.loaded && channel.loadError == nil ? rows : [], submittedRowID: channel.lastSubmittedRowID,
                       sessionID: channel.channelId,
                       composer: AnyView(composer.environment(store).readableWidth()), placeholder: AnyView(placeholder)) { row in
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

    @ViewBuilder
    private func rowView(_ row: ChatRow) -> some View {
        if case .channel(_, let item) = row {
            switch item {
            case .post(let post, let first):
                ChannelPostRow(post: post, first: first, mine: post.isMine(viewerId: channel.viewerId),
                               attachments: channel.sendingAttachments[post.id] ?? [], files: channel.files,
                               resolve: channel.transferGroup, onLink: open(link:))
            case .paused(let text):
                PausedLine(text: text)
            case .typing(let agents):
                TypingRow(agents: agents)
            }
        }
    }

    /// Nuphos pages open in the app, as a conversation's links do; anything else leaves.
    private func open(link url: URL) {
        if !PushNotifications.shared.open(url) { openURL(url) }
    }
}

/// A chat's mark: a hash on the quiet surface.
struct ChannelMark: View {
    var size: CGFloat = 22

    var body: some View {
        Image(systemName: "number")
            .font(.system(size: size * 0.5, weight: .semibold))
            .foregroundStyle(Theme.body)
            .frame(width: size, height: size)
            .background(Theme.bubble, in: RoundedRectangle(cornerRadius: size * 0.27, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// One post: yours on the right, everyone else's on the left. The first of a
/// run carries the avatar and the name. A person's files show above their
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

    private static let avatar: CGFloat = 28

    /// The groups' files when the chat has read them all; else the card reads them.
    private func read(_ groupIds: [String]) -> [TransferDownloadGroup.File]? {
        let groups = groupIds.compactMap { files[$0] }
        return groups.count == groupIds.count ? groups.flatMap { $0 } : nil
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if mine { Spacer(minLength: 48) } else { face }
            VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
                if first, !mine { header }
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
                footer
            }
            if mine { face } else { Spacer(minLength: 48) }
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var face: some View {
        Group {
            if first {
                if post.isAgent {
                    AgentAvatar(agentId: post.senderId, runtime: post.runtime, size: Self.avatar)
                } else {
                    AvatarView(user: NuphosUser(id: post.senderId, email: "", name: post.name, username: "",
                                                avatarURL: post.avatar?.absoluteString ?? ""), size: Self.avatar)
                }
            } else {
                Color.clear
            }
        }
        .frame(width: Self.avatar, height: Self.avatar)
    }

    private var header: some View {
        HStack(spacing: 6) {
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
        AssistantMarkdown(text: post.text, onLink: onLink)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(mine ? Theme.brand.opacity(0.14) : Theme.chatSurface,
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

    private var footer: some View {
        Group {
            if post.sending {
                Text("Sending…")
            } else if let at = post.sentAt {
                Text(at, format: .dateTime.hour().minute())
            }
        }
        .font(.system(size: 11))
        .foregroundStyle(Theme.muted)
        .monospacedDigit()
        .padding(.horizontal, 4)
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
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(agent.title) is thinking")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct TypingDots: View {
    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.16)) { context in
            let step = Int(context.date.timeIntervalSinceReferenceDate / 0.16) % 6
            HStack(spacing: 4) {
                ForEach(0..<3) { index in
                    Circle()
                        .fill(Theme.muted)
                        .frame(width: 6, height: 6)
                        .opacity(step / 2 == index ? 1 : 0.4)
                }
            }
        }
    }
}
