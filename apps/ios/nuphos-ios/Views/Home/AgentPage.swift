import SwiftUI

/// The Agent page: the conversation history for the selected team, with
/// the composer capsule pinned to the bottom when there is no column beside it.
struct AgentPage: View {
    @Environment(AgentStore.self) private var store
    @Binding var page: HomePage
    /// Driven by the search button in the toolbar.
    @Binding var isSearching: Bool
    /// True once the large header has scrolled under the bar.
    @Binding var titleCollapsed: Bool
    /// The chat shown beside (or, when compact, on top of) the list.
    @Binding var openChat: OpenChat?
    /// False when the detail column hosts the new-chat composer instead.
    var showsComposer = true

    /// Whether the keyboard on screen is this page's composer's.
    @State private var ownsKeyboard = false
    @State private var showWorkspaceSetup = false
    @State private var showNewBot = false
    @State private var renaming: AgentConversation?
    @State private var archivingBot: AgentConversation?
    @State private var renamedTitle = ""
    @State private var refreshing = false
    @State private var showArchived = false
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
                defer {
                    Task {
                        try? await Task.sleep(for: .milliseconds(600))
                        refreshing = false
                    }
                }
                if store.selectedTeam == nil { await store.loadTeams() } else { await store.reload() }
            }
            .sheet(isPresented: $showWorkspaceSetup) { WorkspaceSetupSheet() }
            .sheet(isPresented: $showNewBot) {
                NewBotSheet { title, avatar in
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
            .safeAreaInset(edge: .top, spacing: 0) {
                if isSearching {
                    SearchBar(text: $store.search) {
                        store.search = ""
                        isSearching = false
                    }
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(.snappy(duration: 0.25), value: isSearching)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if showsComposer, page == .agent { NewChatComposer(openChat: $openChat) }
            }
            // A chat's keyboard is not this page's to make room for: a back
            // swipe would show this composer gliding down from it.
            .ignoresSafeArea(ownsKeyboard ? [] : .keyboard, edges: .bottom)
            .onPreferenceChange(ComposerOwnsKeyboard.self) { ownsKeyboard = $0 }
            .task(id: store.selectedTeam?.id) { await store.loadCredentialOptions() }
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
        session.answering = target.answering.map { BotQuestion(sessionId: target.sessionId, title: target.title, request: $0) }
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
            ContentUnavailableView {
                Label("Welcome to Nuphos", systemImage: "person.2")
            } description: {
                Text("Create or join a workspace to start chatting with an agent.")
            } actions: {
                Button("Set up workspace") { showWorkspaceSetup = true }.prominentButton()
            }
        case .loaded where store.runtimesLoaded && store.runtimes.isEmpty:
            ContentUnavailableView {
                Label("Connect your first runtime", systemImage: "cpu")
            } description: {
                Text("Open Nuphos on your computer to add a Box or connect your own computer, or ask a workspace administrator to connect one.")
            }
        case .idle, .loading:
            ProgressView("Loading tasks…")
                .tint(Theme.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn't load tasks", systemImage: "wifi.exclamationmark")
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
                Label(store.search.isEmpty ? "No tasks yet" : "No matches", systemImage: "message")
            } description: {
                Text(store.search.isEmpty ? "Start a task from the bar below." : "No tasks match your search.")
            }
        case .loaded:
            EmptyView()
        }
    }

    /// One row with the threads it opened under it: a Task, or on Bots a chat
    /// or a Bot with what the Bot dispatched.
    @ViewBuilder
    private func agentRow(_ item: NestedConversation) -> some View {
                let conversation = item.conversation
                // A Bot's chat acts for the Bot, as on Desktop; a group chat has no actions here.
                let acted = conversation.isProject ? nil : conversation.isChannel ? store.bot(of: conversation) : conversation
                Group {
                    if conversation.isProject {
                        // A project folds its Tasks; it opens nothing.
                        Button { store.toggleFolded(conversation.sessionId) } label: {
                            treeRow(item) { ProjectRow(project: conversation) }.contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    } else if conversation.isChannel {
                        NavigationLink(value: conversation.sessionId) { treeRow(item) { ChannelRow(channel: conversation) } }
                    } else if conversation.isBot {
                        // A Bot with no 1:1 chat yet: the list stays while it is made.
                        Button { Task { await openBotChat(conversation.sessionId) } } label: {
                            treeRow(item) { ChannelRow(channel: conversation) }.contentShape(Rectangle())
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
                .listRowSeparator(item.depth > 0 || (item.hasChildren && !store.isFolded(conversation.sessionId, onBots: page == .chats)) ? .hidden : .automatic)
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    pinAction(conversation)
                    if let acted { rowActions(acted) }
                }
                // The same actions for a long press or a secondary click.
                .contextMenu {
                    pinAction(conversation)
                    if let acted { rowActions(acted) }
                }
    }

    /// A row's content with its thread count, indented on the tree's lines.
    private func treeRow<Row: View>(_ item: NestedConversation, @ViewBuilder row: () -> Row) -> some View {
        let folded = item.hasChildren && store.isFolded(item.id, onBots: page == .chats)
        return HStack(spacing: 0) {
            row()
            if item.hasChildren {
                // The thread count, so it never reads as the row's own disclosure chevron.
                Button { store.toggleFolded(item.id, onBots: page == .chats) } label: {
                    HStack(spacing: 3) {
                        Text("\(item.threads)")
                        Image(systemName: folded ? "chevron.down" : "chevron.up")
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
            if item.done > 0 {
                // Finished threads, counted rather than listed until opened.
                let open = store.isDoneOpen(item.id)
                Button { store.toggleDone(item.id) } label: {
                    HStack(spacing: 3) {
                        Image(systemName: "checkmark.circle")
                        Text("\(item.done) done")
                        Image(systemName: open ? "chevron.up" : "chevron.down")
                            .font(Theme.Text.caption.weight(.semibold))
                    }
                    .font(Theme.Text.label.weight(.medium))
                    .foregroundStyle(Theme.muted)
                    .padding(.leading, 8)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(open ? "Hide \(item.done) done" : "Show \(item.done) done")
            }
        }
        // Insets live here, not on the row, so the tree lines span the whole row.
        .padding(.leading, CGFloat(item.depth) * ThreadTree.indent)
        .padding(.vertical, 12)
        .background(alignment: .leading) {
            ThreadTree(trail: item.trail, expanded: item.hasChildren && !folded)
        }
        // Tasks that ask for the viewer sit above this line, the rest below.
        .padding(.top, item.divider ? 9 : 0)
        .overlay(alignment: .top) {
            if item.divider { Rectangle().fill(Theme.muted.opacity(0.25)).frame(height: 1).accessibilityHidden(true) }
        }
    }

    /// Pin or unpin a Bot or chat, kept in the favorites Desktop shares.
    @ViewBuilder
    private func pinAction(_ row: AgentConversation) -> some View {
        if row.isChannel || row.isBot {
            let pinned = store.isPinned(row)
            let noun = row.isBot || row.botId != nil ? " Bot" : ""
            Button {
                Task { await store.setPinned(!pinned, row) }
            } label: {
                Label(pinned ? "Unpin\(noun)" : "Pin\(noun)", systemImage: pinned ? "pin.slash" : "pin")
            }
            .tint(.yellow)
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
    private func rowActions(_ conversation: AgentConversation) -> some View {
        if conversation.canManage { Button {
            if conversation.isBot { archivingBot = conversation; return }
            Task { await store.archive(sessionId: conversation.sessionId, teamId: conversation.teamId) }
        } label: {
            Label("Archive", systemImage: "archivebox")
        }
        .tint(.orange) }
        if conversation.ownsChat, !conversation.isChannel {
            Button {
                Task {
                    if await store.setBot(!conversation.isBot, conversation: conversation), !conversation.isBot {
                        await openBotChat(conversation.sessionId)
                    }
                }
            } label: {
                Label(conversation.isBot ? "Turn into a Task" : "Make this a Bot", systemImage: conversation.isBot ? "person.crop.circle.badge.minus" : "person.crop.circle.badge.plus")
            }
            .tint(.indigo)
        }
        if let watching = conversation.watching {
            Button {
                Task { await store.setWatching(!watching, conversation: conversation) }
            } label: {
                Label(watching ? "Unwatch" : "Watch", systemImage: watching ? "bell.slash" : "bell")
            }
            .tint(.teal)
            .disabled(store.watchChanges.contains(conversation.sessionId))
        }
        if conversation.ownsChat {
            Button {
                renamedTitle = conversation.displayTitle
                renaming = conversation
            } label: {
                Label("Rename", systemImage: "pencil")
            }
            .tint(.blue)
        }
        if conversation.ownsChat, conversation.parentSessionId != nil {
            Button {
                Task { await store.unlinkParent(conversation) }
            } label: {
                Label("Unlink", systemImage: "link.badge.minus")
            }
            .tint(.gray)
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
            if page == .chats {
                if !store.pins.isEmpty {
                    Section {
                        PinShelf(pins: store.pins) { row in
                            if row.isChannel { openChat = OpenChat(channel: store.channel(for: row)) }
                            else { Task { await openBotChat(row.sessionId) } }
                        }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                        .listRowSeparator(.hidden)
                    }
                }
                Section {
                    ForEach(store.botRows(open: openChat?.id)) { item in agentRow(item) }
                } header: {
                    sectionHeader("Bots") {
                        Button { showNewBot = true } label: {
                            // A 44pt hit area without making the header taller.
                            Image(systemName: "plus")
                                .padding(14)
                                .contentShape(Rectangle())
                                .padding(-14)
                        }
                        .disabled(store.creatingBot || !store.runtimesLoaded)
                        .accessibilityLabel("New Bot")
                    }
                }
            } else {
                Section {
                    ForEach(store.taskRows(open: openChat?.id)) { item in agentRow(item) }

                    if store.hasMore {
                        HStack {
                            Spacer()
                            ProgressView().tint(Theme.muted)
                            Spacer()
                        }
                        .listRowBackground(Color.clear)
                        .task { await store.loadMore() }
                    }
                    // As on Desktop, only once there is something archived or the list failed to load.
                    if !store.archived.isEmpty || store.archivedFailed {
                        Button { showArchived = true } label: {
                            HStack(spacing: 4) {
                                Text("Archived")
                                Image(systemName: "chevron.right").font(Theme.Text.caption.weight(.semibold))
                                Spacer()
                            }
                            .font(Theme.Text.label.weight(.medium))
                            .foregroundStyle(Theme.muted)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Archived")
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                }
            }
        }
        .listStyle(.plain)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.y + geometry.contentInsets.top > PageTitleHeader.collapseThreshold
        } action: { _, collapsed in
            titleCollapsed = collapsed
        }
        .scrollContentBackground(.hidden)
        .background(Theme.canvas)
        .scrollDismissesKeyboard(.interactively)
        .sheet(isPresented: $showArchived) {
            ArchivedList { row in
                showArchived = false
                openChat = row.isChannel ? OpenChat(channel: store.channel(for: row)) : OpenChat(session: store.session(for: row))
            }
        }
    }
}

/// A row under Bots: a chat, or a Bot with no chat yet, by its face. A Bot's
/// chat is named after the Bot. A chat shows its newest post (`lastMessage`),
/// and when it last moved. A Bot's chat says what the Bot is doing, as
/// Desktop's `activityOf`: a question from it or a thread it dispatched
/// first, then the typing dots while it or such a thread is in a turn.
struct ChannelRow: View {
    let channel: AgentConversation
    @Environment(AgentStore.self) private var store

    var body: some View {
        let team = channel.teamId ?? store.selectedTeam?.id ?? ""
        let title = store.title(of: channel)
        let bot = channel.isChannel ? store.bot(of: channel) : nil
        let runs = bot.map { [$0] + store.threads(of: $0) } ?? []
        let question = runs.lazy.compactMap { $0.inputRequests?.first?.question }.first
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
                if let question {
                    Text("Needs your input: \(question)")
                        .font(Theme.Text.label)
                        .foregroundStyle(Theme.body)
                        .lineLimit(1)
                } else if channel.botTyping(in: store.observations, team: team) || runs.contains(where: store.inTurn) {
                    // As iMessage does: the dots stand in for the newest post until the reply lands.
                    TypingDots(size: 5)
                        .frame(height: 16)
                        .accessibilityLabel("\(title) is thinking")
                } else if let preview = channel.previewLine {
                    Text(preview)
                        .font(Theme.Text.label)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
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

/// The expandable search field under the navigation bar. The owning store
/// decides how the query is applied.
struct SearchBar: View {
    @Binding var text: String
    var placeholder: LocalizedStringKey = "Search tasks"
    var onCancel: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Theme.muted)
                TextField(placeholder, text: $text)
                    .focused($focused)
                    .textFieldStyle(.plain)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                if !text.isEmpty {
                    Button {
                        text = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.muted)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 38)
            .contentShape(Capsule())
            .onTapGesture { focused = true }
            .glass(in: Capsule())

            Button("Cancel", action: onCancel)
                .font(.body)
                .keyboardShortcut(.cancelAction)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .onAppear { focused = true }
    }
}

#Preview {
    @Previewable @State var searching = false
    @Previewable @State var page = HomePage.agent
    @Previewable @State var collapsed = false
    NavigationStack {
        AgentPage(page: $page, isSearching: $searching, titleCollapsed: $collapsed, openChat: .constant(nil))
    }
    .environment(AgentStore(token: ""))
}

/// The composer that starts a new chat for the selected team: under the list
/// when compact, in the empty detail column when wide.
struct NewChatComposer: View {
    @Environment(AgentStore.self) private var store
    @Binding var openChat: AgentPage.OpenChat?
    var initialContent: ComposerSubmission? = nil
    var temporaryDirectory: URL = FileManager.default.temporaryDirectory
    var admissionCheck: (() throws -> Void)? = nil
    @State private var draft = ""
    @State private var admissionError: String?
    @State private var failedSubmission: ComposerSubmission?
    @State private var importedContent = false

    private var draftTeam: String { store.selectedTeam?.id ?? "" }

    var body: some View {
        @Bindable var store = store
        ChatComposerBar(text: $draft, canSend: !store.selectedRuntimeUnavailable && !store.newModelSaving && store.credentialsReady, editRequest: $failedSubmission, mentions: draftTeam.isEmpty ? nil : MentionSource(
            teamId: draftTeam,
            devices: store.credentialCatalog?.scoped(to: .devices).allItems ?? [],
            pickDevice: { device in
                if !store.credentialSelection.contains(device) { store.credentialSelection.toggle(device) }
            },
            search: { query in
                await store.loadCredentialOptions()
                return await store.mentionableSessions(teamId: draftTeam, excluding: nil, matching: query)
            }
        ), voiceTeamId: draftTeam.isEmpty ? nil : draftTeam, initialAttachments: initialContent?.attachments ?? [], temporaryDirectory: temporaryDirectory, onSend: { submission in
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
