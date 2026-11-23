import SwiftUI

/// Conversation history for the selected team. Task creation lives in a sheet.
struct AgentPage: View {
    @Environment(AgentStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @Binding var page: HomePage
    /// True once the large header has scrolled under the bar.
    @Binding var titleCollapsed: Bool
    /// The chat shown beside (or, when compact, on top of) the list.
    @Binding var openChat: OpenChat?
    @Binding var showNewBot: Bool

    /// Whether the keyboard on screen is this page's composer's.
    @State private var ownsKeyboard = false
    @State private var showRuntimeSetup = false
    @State private var showWorkspaceSetup = false
    @State private var renaming: AgentConversation?
    @State private var archivingBot: AgentConversation?
    @State private var renamedTitle = ""
    @State private var refreshing = false
    @State private var pulling = false
    #if DEBUG
    /// `-preview-agent-login`: the authorization-code step with a canned attempt.
    @State private var previewLogin = false
    #endif
    #if DEBUG
    @State private var didHandleLaunchAction = false
    #endif

    /// A chat to show, with the prompt a new one starts with. Keyed by
    /// session id, so the list highlights its row once it is listed.
    struct OpenChat: Identifiable, Hashable {
        /// An agent's conversation, or else a chat.
        var session: ChatSession?
        var prompt: ComposerSubmission?
        var channel: ChannelSession?
        var id: String { channel?.channelId ?? session?.sessionId ?? "" }
        static func == (a: OpenChat, b: OpenChat) -> Bool { a.id == b.id }
        func hash(into hasher: inout Hasher) { hasher.combine(id) }
    }

    var body: some View {
        @Bindable var store = store

        content
            // On the switch, so the empty and error states refresh too.
            .refreshable {
                // An alert shown before the pull has settled leaves the spinner running for good.
                refreshing = true
                pulling = true
                defer { pulling = false }
                // Its own task: a read that redraws this page (an empty state does) hands SwiftUI
                // a new refresh action, and SwiftUI cancels the pull it replaces.
                await Task { if store.selectedTeam == nil { await store.loadTeams() } else { await store.reload() } }.value
            }
            // SwiftUI ends the pull only after its task returns, and this runs only when the
            // phase changes, so the first idle after `pulling` ends follows that end at any speed.
            .onScrollPhaseChange { _, phase in
                if phase == .idle, !pulling { refreshing = false }
            }
            .sheet(isPresented: $showRuntimeSetup) { RuntimeSetupGuide().environment(store) }
            .sheet(isPresented: $showWorkspaceSetup) { WorkspaceSetupSheet() }
            .sheet(isPresented: $showNewBot) {
                NewBotSheet(hasRuntime: { store.newConversationRuntime != nil }) { title, avatar in
                    guard let bot = try await store.createBot(title: title, avatar: avatar) else { return }
                    await openBotChat(bot)
                }
            }
            .alert(
                LocalizedStringKey(store.rowActionFailure?.title ?? ""),
                isPresented: Binding(get: { store.rowActionFailure != nil && !refreshing }, set: { if !$0 { store.rowActionFailure = nil } }),
                presenting: store.rowActionFailure
            ) { failure in
                Button("OK", role: .cancel) {}
                Button("Try again") { Task { await failure.retry() } }
            } message: { failure in
                Text(failure.message)
            }
            // Archiving a Bot, from its chat's row or its own, archives its chat too.
            .alert("This is a Bot. Archive the Bot?", isPresented: Binding(get: { archivingBot != nil }, set: { if !$0 { archivingBot = nil } }), presenting: archivingBot) { conversation in
                Button("Cancel", role: .cancel) {}
                Button("Archive Bot", role: .destructive) { Task { await store.archive(sessionId: conversation.sessionId, teamId: conversation.teamId) } }
            } message: { _ in
                Text("Its chat is archived with it. Unarchive either one to bring both back.")
            }
            .alert(renaming?.isBot == true ? "Rename Bot" : "Rename task", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } }), presenting: renaming) { conversation in
                let title = renamedTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                TextField("Title", text: $renamedTitle)
                Button("Cancel", role: .cancel) {}
                Button("Save") { Task { await store.rename(conversation, title: title) } }
                    .disabled(title.isEmpty || title.count > 120)
            }
            #if DEBUG
            .sheet(isPresented: $previewLogin) {
                if let team = store.selectedTeam {
                    AgentSetupSheet(
                        team: team,
                        runtime: RuntimeInstance(id: "preview", provider: .claudeCode, label: "Claude Code", status: .active, kind: "managed", local: nil),
                        login: WorkspaceAPI.Login(attemptId: "preview", state: "awaiting_authorization", authorizationUrl: "https://claude.ai/oauth/authorize", verificationUri: nil, userCode: nil, error: nil, codeSubmitted: false)
                    )
                }
            }
            #endif
            // A chat's keyboard is not this page's to make room for: a back
            // swipe would show this composer gliding down from it.
            .ignoresSafeArea(ownsKeyboard ? [] : .keyboard, edges: .bottom)
            .onPreferenceChange(ComposerOwnsKeyboard.self) { ownsKeyboard = $0 }
            .task(id: store.selectedTeam?.id) { await store.loadCredentialOptions() }
            // A runtime that joined while the app was away shows when it comes back.
            .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await store.loadRuntimes() } } }
            .onChange(of: store.teamsPhase) { _, phase in if phase == .loaded { openPushTarget() } }
            .onChange(of: PushNotifications.shared.pendingTarget) { _, _ in openPushTarget() }
            .task {
                // The poller is what keeps the list fresh while a chat is on
                // top, so coming back needs no reload. Started here so a first
                // chat from an empty list shows up too.
                store.startPolling()
                await store.loadTeams()
                openPushTarget()
                #if DEBUG
                // Returning from a destination starts this task again. Launch
                // actions must not reopen chats (or resend a preview prompt).
                guard !didHandleLaunchAction, !Task.isCancelled else { return }
                didHandleLaunchAction = true
                // `-open-links <url>…`: open each link as if tapped, two seconds
                // apart. Not tied to this page, which leaves when a chat opens.
                if let i = CommandLine.arguments.firstIndex(of: "-open-links") {
                    let links = CommandLine.arguments[(i + 1)...].prefix { !$0.hasPrefix("-") }.compactMap(URL.init(string:))
                    Task {
                        for link in links {
                            try? await Task.sleep(for: .seconds(2))
                            PushNotifications.shared.open(link)
                        }
                    }
                }
                if CommandLine.arguments.contains("-open-first-chat") {
                    openChat = store.conversations.first.map { OpenChat(session: store.session(for: $0)) }
                }
                if CommandLine.arguments.contains("-show-new-bot") { showNewBot = true }
                if CommandLine.arguments.contains("-preview-agent-login") { previewLogin = true }
                // `-preview-approval`: a canned tool run + pending approval, for UI work.
                if CommandLine.arguments.contains("-preview-approval") {
                    let session = store.newSession() ?? ChatSession.fresh(token: "", teamId: "preview")
                    let now = Date.now.timeIntervalSince1970 * 1000
                    func done(_ id: String, _ name: String, _ input: [String: JSONValue], start: Double, end: Double, error: String? = nil) -> ChatPart.ToolPart {
                        var t = ChatPart.ToolPart(toolCallId: id, toolName: name, isDynamic: false, state: error == nil ? .outputAvailable : .outputError)
                        t.input = .object(input)
                        t.output = error == nil ? .string("ok") : nil
                        t.errorText = error
                        t.startedAt = now - start; t.completedAt = now - end
                        return t
                    }
                    var tool = ChatPart.ToolPart(toolCallId: "toolu_preview", toolName: "rm -rf /tmp/build-cache", isDynamic: false, state: .approvalRequested)
                    tool.input = .object(["command": .string("rm -rf /tmp/build-cache"), "description": .string("Clear the build cache")])
                    tool.approval = .init(id: "openab:preview", source: "openab")
                    tool.authorization = .object(["decision": .string("require_auth")])
                    tool.startedAt = now
                    var reasoning = ChatPart.ReasoningPart(text: "The user wants the cache cleared. That is a destructive delete, so I should ask before running it.", state: .done)
                    reasoning.startedAt = Date.now.addingTimeInterval(-7); reasoning.endedAt = Date.now
                    var assistant = ChatMessage(role: .assistant, parts: [
                        .reasoning(reasoning),
                        .tool(done("t1", "Read /workspace/README.md", ["file_path": .string("/workspace/README.md")], start: 9000, end: 8200)),
                        .text(.init(text: "The README says the cache lives under `/tmp/build-cache`. Let me check its size first.", state: .done)),
                        .tool(done("t2", "Terminal", ["command": .string("du -sh /tmp/build-cache")], start: 8000, end: 5100)),
                        .tool(done("t3", "Terminal", ["command": .string("ls /tmp/build-cache/manifest.json")], start: 5000, end: 4800, error: "No such file or directory")),
                        .text(.init(text: "It is 1.2 GB. Clearing it needs your go-ahead:", state: .done)),
                        .tool(tool),
                    ])
                    assistant.createdAt = .now
                    var earlier = ChatMessage(role: .assistant, parts: [
                        .tool(done("e1", "Grep", ["pattern": .string("build-cache")], start: 90000, end: 88000)),
                        .tool(done("e2", "Read /workspace/Makefile", ["file_path": .string("/workspace/Makefile")], start: 88000, end: 87000)),
                        .text(.init(text: "The Makefile writes build output to `/tmp/build-cache`.", state: .done)),
                    ])
                    earlier.createdAt = .now.addingTimeInterval(-90)
                    session.seedForPreview([.user("Where does the build cache live?"), earlier, .user("Clear the build cache please"), assistant])
                    openChat = OpenChat(session: session)
                }
                // `-new-chat "<prompt>"`: start a conversation with that text.
                let args = CommandLine.arguments
                await store.loadCredentialOptions()
                if let i = args.firstIndex(of: "-new-chat"), i + 1 < args.count, let session = store.newSession() {
                    openChat = OpenChat(session: session, prompt: ComposerSubmission(text: args[i + 1], attachments: []))
                }
                #endif
            }
    }

    /// A Bot opens in its 1:1 chat, made the first time. A failure is
    /// reported over the list, and trying again opens the chat (#1738).
    private func openBotChat(_ botId: String) async {
        do {
            if let channel = try await store.botChannel(botId: botId) { openChat = OpenChat(channel: channel) }
        } catch {
            store.rowActionFailure = .init(title: "Couldn't open chat", message: error.localizedDescription) {
                await openBotChat(botId)
            }
        }
    }

    private func openPushTarget() {
        guard let target = PushNotifications.shared.pendingTarget, store.teamsPhase == .loaded else { return }
        PushNotifications.shared.pendingTarget = nil
        // The chat on screen already has this session loaded. A new session
        // with the same id keeps the view's identity, so it would never load.
        guard target.sessionId != openChat?.id else { return }
        if let team = store.teams.first(where: { $0.id == target.teamId }) { store.select(team: team) }
        endEditing()
        // A chat not listed yet opens as a session first; HomeView switches it once loaded.
        if let channel = store.channels.first(where: { $0.sessionId == target.sessionId }) {
            openChat = OpenChat(channel: store.channel(for: channel))
            return
        }
        let session = store.session(sessionId: target.sessionId, title: target.title, teamId: target.teamId)
        openChat = OpenChat(session: session)
    }

    @ViewBuilder
    private var content: some View {
        switch store.phase {
        // Bots always lists, so its "+" can make the first one.
        case .loaded where page == .chats ? store.channelsLoaded && store.selectedTeam != nil && !(store.runtimesLoaded && store.runtimes.isEmpty) : !store.listedConversations.isEmpty:
            list
        default:
            // A scroll view even for the non-list states: with plain
            // content the bar paints an opaque system-black edge.
            ScrollView {
                VStack(spacing: 0) {
                    status
                        .containerRelativeFrame(.vertical) { height, _ in height * 0.8 }
                }
            }
            .background(Theme.canvas)
            .onAppear { titleCollapsed = false }
        }
    }

    @ViewBuilder
    private var status: some View {
        switch store.phase {
        case .loaded where store.selectedTeam == nil:
            SetupEmptyState(title: "Welcome to Nuphos", message: "Create or join a workspace to start working with your team.", actionTitle: "Set up workspace") { showWorkspaceSetup = true }
        case .loaded where store.runtimesLoaded && store.runtimes.isEmpty:
            if let box = store.agentDevices.first(where: \.isStarting) {
                BoxStartingState(label: box.label)
            } else {
                SetupEmptyState(title: "Connect your first runtime", message: "Connect a computer so your Bots and tasks have a place to work.", actionTitle: "Set up a computer") { showRuntimeSetup = true }
                    // An empty workspace may already have a Box on its way, as a new account's free one is.
                    .task(id: store.selectedTeam?.id) { await store.loadAgentDevices(metrics: false) }
            }
        case .idle, .loading:
            ProgressView("Loading tasks…")
                .tint(Theme.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn't load tasks", image: "lucide-wifi-off")
            } description: {
                Text(message)
            } actions: {
                Button("Try again") { Task { await store.loadTeams() } }
                    .prominentButton()
            }
        case .loaded where page == .chats && !store.channelsLoaded:
            ProgressView("Loading chats…")
                .tint(Theme.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded where store.listedConversations.isEmpty:
            ContentUnavailableView {
                Label(store.search.isEmpty ? "No tasks yet" : "No matches", image: "lucide-message-circle")
            } description: {
                if !store.search.isEmpty { Text("No tasks match your search.") }
            }
        case .loaded:
            EmptyView()
        }
    }

    /// One row: a Task with the threads it opened under it, or on Bots a chat or a Bot.
    @ViewBuilder
    private func agentRow(_ item: NestedConversation) -> some View {
                let conversation = item.conversation
                // A Bot's chat acts for the Bot, as on Desktop; a group chat has no actions here.
                let acted = conversation.isChannel ? store.bot(of: conversation) : conversation
                let row = Group {
                    if conversation.isChannel {
                        NavigationLink(value: conversation.sessionId) { treeRow(item) { ChannelRow(channel: conversation) } }
                    } else if conversation.isBot {
                        // A Bot with no 1:1 chat yet: the list stays while it is made.
                        // A Button, not a link: picking a link would show the chat before it exists, and
                        // hide the list that reports a failure (#1738). It ends with the links' chevron (#3614).
                        Button { Task { await openBotChat(conversation.sessionId) } } label: {
                            HStack(spacing: 0) {
                                treeRow(item) { ChannelRow(channel: conversation) }
                                Image(systemName: "chevron.forward")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(.tertiary)
                                    .padding(.leading, 11)
                                    .opacity(store.creatingBot ? 0 : 1)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(store.creatingBot)
                        .overlay(alignment: .trailing) { if store.creatingBot { ProgressView() } }
                    } else {
                        NavigationLink(value: conversation.sessionId) {
                            treeRow(item) { ConversationRow(conversation: conversation, hidden: item.hidden) }
                        }
                    }
                }
                // A custom row background hides the system selection
                // highlight, so the open chat's row draws its own.
                .listRowBackground(openChat?.id == conversation.sessionId ? Theme.muted.opacity(0.12) : Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 16))
                .listSectionSeparator(.hidden, edges: .top)
                // A separator would cut through the lines of an open tree.
                .listRowSeparator(.hidden)
                if page == .chats {
                    row.swipeActions(edge: .leading, allowsFullSwipe: false) {
                        pinAction(conversation)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        if let acted, acted.canArchive {
                            Button {
                                if acted.isBot { archivingBot = acted }
                                else { Task { await store.archive(sessionId: acted.sessionId, teamId: acted.teamId) } }
                            } label: { Label("Archive", image: "lucide-archive") }
                        }
                    }
                    .contextMenu {
                        pinAction(conversation)
                        if let acted { rowActions(acted, tinted: false) }
                    } preview: {
                        BotConversationPreview(conversation: conversation, title: store.title(of: conversation))
                    }
                } else {
                    row.swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        if let acted, acted.canArchive {
                            Button {
                                if acted.isBot { archivingBot = acted }
                                else { Task { await store.archive(sessionId: acted.sessionId, teamId: acted.teamId) } }
                            } label: { Label("Archive", image: "lucide-archive") }
                        }
                    }
                    .contextMenu { if let acted { rowActions(acted, tinted: false) } }
                }
    }

    /// A row's content with its thread count, indented on the tree's lines.
    private func treeRow<Row: View>(_ item: NestedConversation, @ViewBuilder row: () -> Row) -> some View {
        let folded = item.hasChildren && store.isFolded(item.id)
        return HStack(spacing: 0) {
            row()
            if item.hasChildren {
                // The thread count, so it never reads as the row's own disclosure chevron.
                Button { store.toggleFolded(item.id) } label: {
                    HStack(spacing: 3) {
                        Text("\(item.threads)")
                        LucideIcon(systemName: folded ? "chevron.down" : "chevron.up")
                            .font(Theme.Text.caption.weight(.semibold))
                    }
                    .font(Theme.Text.label.weight(.medium))
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 8)
                    .frame(height: 24)
                    .background(Capsule().fill(Theme.muted.opacity(0.12)))
                    .padding(.leading, 8)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(folded ? "Show \(item.threads) sub-agents" : "Hide \(item.threads) sub-agents")
            }
        }
        // Insets live here, not on the row, so the tree lines span the whole row.
        .padding(.leading, CGFloat(item.depth) * ThreadTree.indent)
        .padding(.vertical, page == .chats ? 12 : 8)
        .frame(minHeight: 44)
        .background(alignment: .leading) {
            ThreadTree(trail: item.trail, expanded: item.hasChildren && !folded)
        }
    }

    /// Pin or unpin a Bot or chat, kept in the favorites Desktop shares.
    @ViewBuilder
    private func pinAction(_ row: AgentConversation) -> some View {
        if row.isChannel || row.isBot {
            let pinned = store.isPinned(row)
            let bot = row.isBot || row.botId != nil
            let title = pinned
                ? (bot ? String(localized: "Unpin Bot") : String(localized: "Unpin"))
                : (bot ? String(localized: "Pin Bot") : String(localized: "Pin"))
            Button {
                Task { await store.setPinned(!pinned, row) }
            } label: {
                Label(title, image: pinned ? "lucide-pin-off" : "lucide-pin")
            }
        }
    }

    private func sectionHeader<Action: View>(_ title: String, @ViewBuilder action: () -> Action = { EmptyView() }) -> some View {
        HStack {
            Text(title).font(Theme.Text.label.weight(.semibold)).foregroundStyle(Theme.muted)
            Spacer()
            action().foregroundStyle(Theme.muted)
        }
    }

    @ViewBuilder
    private func rowActions(_ conversation: AgentConversation, tinted: Bool = true) -> some View {
        if conversation.canArchive { Button {
            if conversation.isBot { archivingBot = conversation; return }
            Task { await store.archive(sessionId: conversation.sessionId, teamId: conversation.teamId) }
        } label: {
            Label("Archive", image: "lucide-archive")
        }
        .tint(tinted ? .orange : nil) }
        if conversation.ownsChat, !conversation.isChannel {
            Button {
                Task {
                    if await store.setBot(!conversation.isBot, conversation: conversation), !conversation.isBot {
                        await openBotChat(conversation.sessionId)
                    }
                }
            } label: {
                Label(conversation.isBot ? "Turn into a Task" : "Make this a Bot", image: conversation.isBot ? "lucide-user-round-minus" : "lucide-user-plus")
            }
            .tint(tinted ? .indigo : nil)
        }
        if let watching = conversation.watching {
            Button {
                Task { await store.setWatching(!watching, conversation: conversation) }
            } label: {
                Label(watching ? "Unwatch" : "Watch", image: watching ? "lucide-bell-off" : "lucide-bell")
            }
            .tint(tinted ? .teal : nil)
            .disabled(store.watchChanges.contains(conversation.sessionId))
        }
        if conversation.ownsChat {
            Button {
                renamedTitle = conversation.displayTitle
                renaming = conversation
            } label: {
                Label("Rename", image: "lucide-pencil")
            }
            .tint(tinted ? .blue : nil)
        }
        if conversation.ownsChat, conversation.parentSessionId != nil {
            Button {
                Task { await store.unlinkParent(conversation) }
            } label: {
                Label("Unlink", image: "lucide-unlink")
            }
            .tint(tinted ? .gray : nil)
        }
    }

    /// The list's selection is the open chat's id; picking a row opens it.
    private var selection: Binding<String?> {
        Binding {
            openChat?.id
        } set: { id in
            guard id != openChat?.id else { return }
            endEditing()
            if let channel = store.channels.first(where: { $0.sessionId == id }) {
                openChat = OpenChat(channel: store.channel(for: channel))
                return
            }
            // A Task, or a thread a Bot dispatched, listed under Bots.
            openChat = store.conversations.first { $0.sessionId == id }.map { OpenChat(session: store.session(for: $0)) }
        }
    }

    private var list: some View {
        List(selection: selection) {
            if page == .chats, !store.pins.isEmpty, store.search.isEmpty {
                Section {
                } header: {
                    PinShelf(pins: store.pins) { row in
                        if row.isChannel { openChat = OpenChat(channel: store.channel(for: row)) }
                        else { Task { await openBotChat(row.sessionId) } }
                    }
                    .textCase(nil)
                    .padding(.vertical, 12)
                }
                .listRowInsets(EdgeInsets())
            }
            if page == .chats {
                Section {
                    ForEach(store.nestedBots) { item in agentRow(item) }
                }
            } else {
                Section {
                    ForEach(store.nestedConversations) { item in agentRow(item) }
                }
            }
        }
        .listStyle(.plain)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.y + geometry.contentInsets.top > PageTitleHeader.collapseThreshold
        } action: { _, collapsed in
            titleCollapsed = collapsed
        }
        .listRowSeparator(.hidden)
        .scrollContentBackground(.hidden)
        .background(Theme.canvas)
        .scrollDismissesKeyboard(.interactively)
    }
}

/// A row under Bots: a chat, or a Bot with no chat yet, by its face. A Bot's
/// chat is named after the Bot. A chat shows its newest post (`lastMessage`),
/// on up to two lines, and when it last moved. The row shows the chat's typing
/// dots exactly while the chat shows them (#3522). A question from the Bot stays
/// in the Inbox (#4508), and a Bot at work adds nothing else here.
struct ChannelRow: View {
    let channel: AgentConversation
    @Environment(AgentStore.self) private var store

    var body: some View {
        let team = channel.teamId ?? store.selectedTeam?.id ?? ""
        let title = store.title(of: channel)
        HStack(spacing: 12) {
            if channel.isChannel {
                ChatIcon(faces: channel.faces ?? [], title: title, size: 36)
            } else {
                AgentAvatar(agentId: channel.sessionId, runtime: channel.agentRuntime, size: 36)
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(title)
                        .font(Theme.Text.body.weight(.medium))
                        .foregroundStyle(Theme.heading)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(HistoryTime.format(channel.lastActiveAt))
                        .font(Theme.Text.label)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                if channel.botTyping(in: store.observations, team: team) {
                    // As iMessage does: the dots stand in for the newest post until the reply lands.
                    TypingDots(size: 5)
                        .frame(height: 16)
                        .accessibilityLabel("\(title) is thinking")
                } else if let preview = channel.previewLine {
                    Text(preview)
                        .font(Theme.Text.label)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(2)
                }
            }
            if store.unread.contains(team: team, session: channel.sessionId) {
                Circle().fill(Theme.unread).frame(width: 7, height: 7).accessibilityLabel("Unread posts")
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }
}

#Preview {
    @Previewable @State var newBot = false
    @Previewable @State var page = HomePage.agent
    @Previewable @State var collapsed = false
    NavigationStack {
        AgentPage(page: $page, titleCollapsed: $collapsed, openChat: .constant(nil), showNewBot: $newBot)
    }
    .environment(AgentStore(token: ""))
}

/// The reusable composer that starts a new chat for the selected team.
struct NewChatComposer: View {
    var autoFocus = false
    @Environment(AgentStore.self) private var store
    @Binding var openChat: AgentPage.OpenChat?
    var initialContent: ComposerSubmission? = nil
    var temporaryDirectory: URL = FileManager.default.temporaryDirectory
    var admissionCheck: (() throws -> Void)? = nil
    @State private var draft = ""
    @State private var admissionError: String?
    @State private var failedSubmission: ComposerSubmission?
    @State private var importedContent = false
    @State private var focusRequest = 0

    private var draftTeam: String { store.selectedTeam?.id ?? "" }

    var body: some View {
        @Bindable var store = store
        ChatComposerBar(text: $draft, canSend: !store.selectedRuntimeUnavailable && !store.newModelSaving && store.credentialsReady, editRequest: $failedSubmission, mentions: draftTeam.isEmpty ? nil : MentionSource(
            teamId: draftTeam,
            devices: store.credentialCatalog?.scoped(to: .devices).allItems ?? [],
            pickDevice: { device in
                if !store.credentialSelection.contains(device) { store.credentialSelection.toggle(device) }
            },
            sessions: store.mentionableSessions(teamId: draftTeam, excluding: nil),
            refresh: {
                async let devices: () = store.loadCredentialOptions()
                await store.loadMentionableSessions(teamId: draftTeam)
                await devices
            }
        ), voiceTeamId: draftTeam.isEmpty ? nil : draftTeam, initialAttachments: initialContent?.attachments ?? [], temporaryDirectory: temporaryDirectory, focusRequest: focusRequest, onSend: { submission in
            do {
                try admissionCheck?()
                guard let session = store.newSession() else { throw SharedShareSession.Failure.workspace }
                session.admissionCheck = admissionCheck
                endEditing()
                openChat = AgentPage.OpenChat(session: session, prompt: submission)
            } catch {
                failedSubmission = submission
                admissionError = error.localizedDescription
            }
        }) {
            ComposerControls(selection: $store.credentialSelection, mode: $store.permissionMode, session: nil)
        }
        .task {
            guard autoFocus else { return }
            do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
            focusRequest += 1
        }
        .onAppear {
            if let initialContent, !importedContent {
                importedContent = true
                draft = initialContent.text
            } else if initialContent == nil, draft.isEmpty { draft = ComposerDrafts.text(team: draftTeam, session: "new", identity: store.token) }
        }
        .onChange(of: store.selectedTeam?.id) { old, new in
            if initialContent == nil { draft = ComposerDrafts.switchTeam(visible: draft, session: "new", from: old ?? "", to: new ?? "", identity: store.token) }
        }
        .onChange(of: draft) { _, text in
            if initialContent == nil { ComposerDrafts.set(text, team: draftTeam, session: "new", identity: store.token) }
        }
        .alert("Couldn't send", isPresented: Binding(get: { admissionError != nil }, set: { if !$0 { admissionError = nil } })) {
            Button("OK", role: .cancel) { admissionError = nil }
        } message: { Text(admissionError ?? "") }
    }
}

/// Puts the list's keyboard away before a chat opens. UIKit remembers the
/// focus a pushed chat covered and hands it back when a back swipe starts,
/// raising a keyboard that lifts the chat's composer mid-swipe.
private func endEditing() {
    #if canImport(UIKit) && !NUPHOS_SHARE_EXTENSION
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    #endif
}

/// Shown for a Box still coming up while the workspace has no runtime, in place of advice to
/// connect a computer. It re-reads both lists every 5 s until the Box's runtimes are listed,
/// which takes this view off screen and ends the loop.
private struct BoxStartingState: View {
    @Environment(AgentStore.self) private var store
    let label: String
    var body: some View {
        VStack(spacing: 16) {
            ProgressView().tint(Theme.muted)
            Text("\(label) is getting ready").font(.title3.weight(.semibold)).foregroundStyle(Theme.heading).multilineTextAlignment(.center)
            Text("It will show up here as soon as it is online. This can take a minute or two.").font(.callout).foregroundStyle(Theme.body).multilineTextAlignment(.center)
        }
        .padding(24).frame(maxWidth: 400).frame(maxWidth: .infinity, maxHeight: .infinity)
        .task {
            while true {
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
                // Runtimes first: the Box read as up before its runtime is listed would end this loop early.
                await store.loadRuntimes(force: true)
                await store.loadAgentDevices(metrics: false)
            }
        }
    }
}
