import SwiftUI

/// The signed-in shell shares its stores across three native home tabs.
/// The split view keeps conversation navigation and its keyboard behavior intact.
struct HomeView: View {
    @Environment(AuthSession.self) private var session
    let user: NuphosUser

    @State private var page: HomePage = Self.initialPage
    /// The viewer picked a page, so the default tab no longer applies. A
    /// DEBUG `-page` launch argument is a pick too.
    @State private var pageChosen = CommandLine.arguments.contains("-page")
    /// The next page change is the default tab, not the viewer's pick.
    @State private var autoPage = false
    @State private var showTeamPicker = false
    @State private var sideTabBar = false
    @State private var showProfile = false
    @State private var resumeTwoFactor = false
    @State private var showNewBot = false
    @State private var showNewTask = false
    @State private var submittedTask: AgentPage.OpenChat?
    @State private var workspacePage: HomePage? = Self.initialWorkspacePage
    @State private var titleCollapsed = false
    @State private var store: AgentStore?
    @State private var plans: PlansStore?
    @State private var connectors: ConnectorsStore?
    /// The selected team's open questions: the Inbox page and its badge.
    @State private var inbox: OpenQuestions?
    @State private var openChat: AgentPage.OpenChat?
    @State private var botTask: ChatSession?
    @State private var showBotTask = false
    /// A desktop shows beside the open conversation, with the list put away meanwhile.
    @State private var desktopOpen = false
    private var columns: Binding<NavigationSplitViewVisibility> { NavigationSplitViewVisibility.home(desktopOpen: desktopOpen) }
    private var desktopBeside: ((Bool) -> Void)? {
        guard sizeClass == .regular else { return nil }
        return { open in desktopOpen = open }
    }
    /// The window's, not a column's: a split view's columns report compact.
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.scenePhase) private var scenePhase
    /// Read the open chat and agent conversation. Here, not on their views:
    /// collapsed, SwiftUI ends a view's appearance while it stays on screen (#1440).
    @State private var chatReader = UUID()
    @State private var conversationReader = UUID()

    var body: some View {
        // Collapses to a single stack when compact; side by side when wide,
        // such as iPhone Duo's inner display and iPad.
        NavigationSplitView(columnVisibility: columns) {
            Group {
                if let store, let plans, let connectors {
                    pageContent
                        .sheet(item: Bindable(PushNotifications.shared).pendingPlan) { target in
                            PlanLinkSheet(target: target) { PushNotifications.shared.pendingPlan = nil }
                        }
                        .environment(store)
                        .environment(plans)
                        .environment(connectors)
                        // The root content reappears after a pushed chat is
                        // popped; the enclosing NavigationStack never left.
                        .onAppear {
                            Analytics.shared.screen(page.rawValue, teamID: store.selectedTeam?.id)
                        }
                } else {
                    Theme.canvas
                }
            }
            .navigationSplitViewColumnWidth(min: 380, ideal: 400, max: 500)
            // The title and workspace actions stay above the native home tabs.
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .navigationTitle("")
            // Wide, the list always stays: there is nothing to put it away with.
            .toolbar(removing: .sidebarToggle)
            .toolbar {
                if !coverHeader, let store, !store.teams.isEmpty {
                    ToolbarItem(placement: .topBarLeading) { teamButton(store) }
                }
                // One item, not a group: on an iPhone, iOS 27 folds a group into "More",
                // and Account and Computers went with it.
                if !coverHeader, sizeClass != .regular || openChat != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        HStack(spacing: 0) { homeActions }.buttonStyle(.plain)
                    }
                }
            }
            .toolbar(coverHeader ? .hidden : .automatic, for: .navigationBar)
            #if DEBUG
            .onAppear { if ProcessInfo.processInfo.arguments.contains("-show-app-icons") { showProfile = true } }
            #endif
            .sheet(isPresented: $showNewTask, onDismiss: {
                if let submittedTask {
                    openChat = submittedTask
                    self.submittedTask = nil
                }
            }) {
                NavigationStack {
                    VStack(spacing: 0) {
                        ScrollView {
                            NewTaskWelcome(name: user.name)
                        }
                        .defaultScrollAnchor(.center, for: .alignment)
                        .frame(maxHeight: .infinity)
                        NewChatComposer(autoFocus: true, openChat: Binding(get: { nil }, set: { chat in
                            guard let chat else { return }
                            submittedTask = chat
                            showNewTask = false
                        }))
                        .readableWidth()
                    }
                    .background(Theme.chatCanvas)
                    .navigationTitle("New Task")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") { showNewTask = false }
                        }
                    }
                }
                .environment(store)
                .presentationDetents([.large])
            }
            .onAppear { if TwoFactorView.takeResume() { resumeTwoFactor = true; showProfile = true } }
            .sheet(isPresented: $showProfile, onDismiss: { resumeTwoFactor = false }) {
                ProfileSheet(user: user, openTwoFactor: resumeTwoFactor)
            }
            .sheet(item: workspaceSheet) { destination in
                NavigationStack {
                    workspaceContent(destination)
                        .navigationTitle(destination == .runtimes ? Text("Computers & runtimes") : Text("Connectors"))
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button { workspacePage = nil } label: { LucideIcon("x") }
                                    .accessibilityLabel("Close")
                            }
                        }
                }
                .environment(store)
                .environment(connectors)
            }
            #if DEBUG
            .overlay {
                if CommandLine.arguments.contains("-preview-logos") { LogoPreviewGrid() }
            }
            #endif
        } detail: {
            // One stable root. Collapsed, swapping the column's root between
            // these views made a reopened chat appear and vanish at once: its
            // tasks were cancelled while it stayed on screen, never loading.
            NavigationStack {
            ZStack {
                if let channel = openChat?.channel {
                    ChannelView(channel: channel) { task, title in
                        guard let store else { return }
                        botTask = store.session(sessionId: task, title: title, teamId: channel.teamId)
                        showBotTask = true
                    }
                        .id(channel.channelId)
                        .toolbar { newAgentItem }
                } else if let openChat, let chatSession = openChat.session {
                    ConversationView(session: chatSession, initialPrompt: openChat.prompt, onArchived: { self.openChat = nil })
                        .id(openChat.id)
                        // A link to a chat opens as a session until its kind is known.
                        .onChange(of: chatSession.isChannel) { _, isChannel in
                            guard isChannel, let store else { return }
                            self.openChat = AgentPage.OpenChat(channel: store.channel(
                                sessionId: chatSession.sessionId, title: chatSession.title, teamId: chatSession.teamId))
                        }
                        // Wide layouts expose the same task-creation sheet.
                        .toolbar { newAgentItem }
                } else if page == .inbox, let inbox, let question = inbox.list.first(where: { $0.id == inbox.selected }) {
                    InboxQuestionView(inbox: inbox, question: question)
                        .id(question.id)
                } else {
                    Theme.canvas.ignoresSafeArea()
                }
            }
            .toolbar {
                if sizeClass == .regular, openChat == nil {
                    ToolbarItemGroup(placement: .topBarTrailing) { homeActions }
                }
            }
            .navigationDestination(isPresented: $showBotTask) {
                if let botTask {
                    ConversationView(session: botTask, onArchived: { showBotTask = false; self.botTask = nil; openChat = nil })
                        .onAppear { store?.follow(botTask) }
                        .onDisappear { store?.follow(nil) }
                }
            }
            }
        }
        // Wide, the list stays beside the detail. The automatic style overlays
        // it on a portrait-shaped window, where picking a chat put it away.
        .navigationSplitViewStyle(.balanced)
        // On the split view itself, so the detail column and pushed
        // destinations see the store too — not only pageContent.
        .environment(store)
        .environment(plans)
        .environment(connectors)
        // Wide, a conversation shows its desktop beside it, with the list put away meanwhile.
        .environment(\.desktopBeside, desktopBeside)
        .tint(Theme.heading)
        .animation(.easeOut(duration: 0.2), value: titleCollapsed)
        .onAppear {
            var token = session.token
            #if DEBUG
            if token == nil, CommandLine.arguments.contains("-preview-home") { token = "" }
            #endif
            if store == nil, let token {
                #if DEBUG && targetEnvironment(simulator)
                store = AgentStore(token: token, loadsHistory: !CommandLine.arguments.contains("-share-verification"))
                #else
                store = AgentStore(token: token)
                #endif
                store?.me = ChatMessage.Sender(name: user.name, avatarURL: user.avatarURL)
                store?.userId = user.id
                plans = PlansStore(token: token)
                connectors = ConnectorsStore(token: token)
            }
            if let loginID = session.sharingLoginID, let token = session.token {
                store?.bindSharingLogin(loginID, token: token)
            }
        }
        .onChange(of: session.sharingLoginID, initial: true) { _, loginID in
            guard session.user?.id == user.id, let loginID, let token = session.token else { return }
            store?.bindSharingLogin(loginID, token: token)
        }
        // While a chat is open and the app active, it is read up to its newest
        // post, and it alone polls; becoming active again reads it at once.
        .onChange(of: scenePhase == .active ? openChat?.channel?.channelId : nil, initial: true) { _, id in
            store?.unread.setReading(id != nil, reader: chatReader,
                                                 team: openChat?.channel?.teamId ?? "", session: id ?? "")
            store?.poll(id == nil ? nil : openChat?.channel)
        }
        // An agent's conversation the same way: read and polled while it is open and the app active.
        .onChange(of: scenePhase == .active ? openChat?.session?.sessionId : nil, initial: true) { _, id in
            store?.unread.setReading(id != nil, reader: conversationReader,
                                                 team: openChat?.session?.teamId ?? "", session: id ?? "")
            store?.follow(id == nil ? nil : openChat?.session)
        }
        .focusedSceneValue(\.newChat) {
            page = .agent
            showNewTask = true
        }
        // Tasks lists no chat (#2708), and compact opens one by selecting its row, so a chat
        // opened from Tasks, as "Make this a Bot" opens one, opens on Bots instead.
        .onChange(of: openChat?.channel?.channelId) { _, id in
            guard id != nil, page == .agent, let chat = openChat else { return }
            page = .chats
            // After the page change below has cleared it.
            Task { openChat = chat }
        }
        .onChange(of: openChat?.id) { _, _ in
            showBotTask = false
            botTask = nil
        }
        .onChange(of: page) { oldPage, newPage in
            showBotTask = false
            botTask = nil
            if autoPage { autoPage = false } else { pageChosen = true }
            openChat = nil
            inbox?.selected = nil
            UIEventLog.pageTransition(from: oldPage.rawValue, to: newPage.rawValue)
            Analytics.shared.screen(newPage.rawValue, teamID: store?.selectedTeam?.id)
        }
        // Polled while the app is active, as the desktop's badge is, so the count stays current on every page.
        .task(id: scenePhase == .active ? store?.selectedTeam?.id : nil) {
            guard scenePhase == .active, let store, let team = store.selectedTeam?.id else { return }
            if inbox?.teamId != team {
                inbox = OpenQuestions(token: store.token, teamId: team)
            }
            while !Task.isCancelled {
                await inbox?.refresh()
                try? await Task.sleep(for: .seconds(15))
            }
        }
        // The workspace loads with the shell, not with one tab: a page opened first needs it too (#4040).
        .task(id: store != nil) { await store?.loadTeams() }
        .onChange(of: store?.selectedTeam?.id) { _, teamID in
            Analytics.shared.screen(page.rawValue, teamID: teamID)
        }
        // Off the lists, a notification or link opens over the list it is on: Tasks lists no Bot,
        // chat or Bot's Task (#2708), so anything but a listed Task returns to Bots.
        .onChange(of: PushNotifications.shared.pendingTarget, initial: true) { _, target in
            guard let target, !page.isHomeList else { return }
            page = store?.listedConversations.contains { $0.sessionId == target.sessionId } == true ? .agent : .chats
        }
        // The default tab, once the chats are known: Chats when there is one.
        // Never after the viewer picked a page, nor under a chat already open.
        .onChange(of: store?.channelsLoaded) { _, loaded in
            guard loaded == true, let store, !pageChosen, openChat == nil, page.isHomeList else { return }
            let tab: HomePage = store.botsList.isEmpty ? .agent : .chats
            if tab != page { autoPage = true; page = tab }
        }
        .onChange(of: PushNotifications.shared.pendingConversations, initial: true) { _, show in
            guard show else { return }
            PushNotifications.shared.pendingConversations = false
            page = .agent
            openChat = nil
        }
    }

    /// Create another task without replacing the current conversation first.
    @ToolbarContentBuilder
    private var newAgentItem: some ToolbarContent {
        if sizeClass == .regular {
            ToolbarItem(placement: .topBarLeading) {
                DesignButton("New task", image: "lucide-square-pen") { showNewTask = true }
            }
        }
    }

    private func teamButton(_ store: AgentStore) -> some View {
        Button { showTeamPicker = true } label: {
            HStack(spacing: 6) {
                if let team = store.selectedTeam { TeamAvatar(team: team) }
                Text(store.selectedTeam?.name ?? String(localized: "Choose team"))
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: sizeClass == .regular ? (openChat == nil ? nil : 90) : Self.compactTeamNameWidth, alignment: .leading)
                LucideIcon("chevron-down", size: 14)
            }
        }
        .sheet(isPresented: $showTeamPicker) {
            TeamSwitcherPopover(store: store)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(.ultraThinMaterial)
        }
        .accessibilityLabel("Switch team")
    }

    /// iOS 27 puts the tab bar beside the content on iPhone Duo's folded cover screen (each
    /// tab measured an 84 pt trailing safe-area inset there, none on an iPhone in portrait) and
    /// moves the navigation bar's trailing items into a column next to it, where Account hung
    /// past the screen's edge (#3433). There the header sits on top of the content instead. An
    /// iPhone in landscape insets the sides too, but its height is compact.
    private var coverHeader: Bool { sizeClass != .regular && verticalSizeClass == .regular && sideTabBar }

    /// The header the navigation bar holds everywhere else.
    @ViewBuilder
    private func withCoverHeader(_ content: some View) -> some View {
        let measured = content.onGeometryChange(for: Bool.self) {
            $0.safeAreaInsets.leading + $0.safeAreaInsets.trailing > 0
        } action: { sideTabBar = $0 }
        if coverHeader {
            measured.safeAreaInset(edge: .top) {
                HStack {
                    if let store, !store.teams.isEmpty {
                        teamButton(store).buttonStyle(.plain).padding(.horizontal, 12).frame(height: 44)
                            .glass(interactive: true, in: Capsule())
                    }
                    Spacer()
                    HStack(spacing: 0) { homeActions }.buttonStyle(.plain).padding(.horizontal, 4)
                        .glass(interactive: true, in: Capsule())
                }
                .padding([.horizontal, .top], 16)
            }
        } else {
            measured
        }
    }

    /// On an iPhone the team's name takes only the width the rest of the toolbar leaves, so
    /// Create, Computers and Account never fold into "More". Measured on iOS 27: the team
    /// pill's margin, avatar, chevron, spacing and padding (82 pt), the trailing pill with
    /// its margin (136 pt), and a gap between them (16 pt). At most 180 pt.
    private static var compactTeamNameWidth: CGFloat {
        min(180, UIScreen.main.bounds.width - 234)
    }

    /// DEBUG: `-page runtimes` opens that page directly, for UI checks.
    private static var initialPage: HomePage {
        #if DEBUG
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "-page"), i + 1 < args.count, let page = HomePage(rawValue: args[i + 1]),
           page.isHomeList || page == .inbox {
            return page
        }
        #endif
        return HomePage.hasChats ? .chats : .agent
    }

    @ViewBuilder
    private var homeActions: some View {
            Menu {
                // The sheet lives on the Bots page, where the new Bot is listed (#3947).
                Button { page = .chats; showNewBot = true } label: {
                    Label("New Bot", image: "home-tab-bots")
                }
                Button { showNewTask = true } label: {
                    Label("New Task", image: "home-tab-tasks")
                }
            } label: {
                LucideIcon("plus", size: 16).frame(width: 36, height: 44)
            }
            .accessibilityLabel("Create")
            .disabled(store?.canStartTask != true)
            Button { workspacePage = .runtimes } label: {
                LucideIcon("monitor", size: 16).frame(width: 36, height: 44)
            }
            .accessibilityLabel("Computers & runtimes")
            .disabled(store == nil)
            Button { showProfile = true } label: {
                AvatarView(user: user, size: 24).frame(width: 36, height: 44)
            }
            .accessibilityLabel("Account")
    }

    private var pageContent: some View {
        TabView(selection: $page) {
            Tab("Bots", image: "home-tab-bots", value: HomePage.chats) {
                withCoverHeader(homeList(.chats))
            }
            .badge(store?.pageCounts[.chats] ?? 0)
            Tab("Tasks", image: "home-tab-tasks", value: HomePage.agent) {
                withCoverHeader(homeList(.agent))
            }
            .badge(store?.pageCounts[.agent] ?? 0)
            Tab("Inbox", image: "home-tab-inbox", value: HomePage.inbox) {
                withCoverHeader(InboxPage(inbox: inbox, wide: sizeClass == .regular))
            }
            .badge(inbox?.waiting.count ?? 0)
        }
    }

    private func homeList(_ tab: HomePage) -> some View {
        AgentPage(page: .constant(tab),
                  titleCollapsed: $titleCollapsed, openChat: $openChat, showNewBot: tab == .chats ? $showNewBot : .constant(false))

    }

    @ViewBuilder
    private func workspaceContent(_ destination: HomePage) -> some View {
        switch destination {
        case .runtimes: RuntimesPage()
        default: ConnectorsPage()
        }
    }

    /// The workspace sheet is handed the store, so it waits for one: opened from the
    /// toolbar there always is, but `-page` asks for it before the store is built.
    private var workspaceSheet: Binding<HomePage?> {
        Binding(get: { store == nil ? nil : workspacePage }, set: { workspacePage = $0 })
    }

    private static var initialWorkspacePage: HomePage? {
        #if DEBUG
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "-page"), i + 1 < args.count,
           let page = HomePage(rawValue: args[i + 1]), page == .runtimes || page == .connectors {
            return page
        }
        #endif
        return nil
    }

}

/// Splits trailing controls into separate glass groups. Before iOS 26
/// there are no glass groups to split.
private struct GlassGroupSpacer: ToolbarContent {
    var body: some ToolbarContent {
        if #available(iOS 26, *) {
            ToolbarSpacer(.fixed, placement: .topBarTrailing)
        }
    }
}

extension ToolbarContent {
    /// Drops the shared glass behind an item that draws its own (iOS 26).
    @ToolbarContentBuilder
    func sharedBackgroundHidden() -> some ToolbarContent {
        if #available(iOS 26, *) {
            sharedBackgroundVisibility(.hidden)
        } else {
            self
        }
    }
}

#Preview {
    HomeView(user: .preview).environment(AuthSession())
}

#if DEBUG
/// `-preview-logos`: every brand mark from the asset catalog, to eyeball
/// that Xcode rendered each SVG.
private struct LogoPreviewGrid: View {
    private var names: [String] {
        CredentialCatalog.providers.map(\.logo) + ["logo-claude", "logo-openai", "logo-grok", "logo-antigravity", "logo-opencode", "logo-deepseek"]
    }

    var body: some View {
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 20) {
                ForEach(names, id: \.self) { name in
                    VStack(spacing: 6) {
                        BrandLogo(name: name, size: 40).foregroundStyle(Theme.heading)
                        Text(name.replacingOccurrences(of: "logo-", with: "")).font(.system(size: 11)).foregroundStyle(Theme.muted)
                    }
                }
            }
            .padding(24)
        }
        .background(Theme.canvas)
    }
}
#endif
