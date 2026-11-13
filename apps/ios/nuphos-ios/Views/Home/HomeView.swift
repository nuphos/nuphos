import SwiftUI

/// The signed-in shell: the page name is the (large) navigation title and
/// doubles as the page switcher via the title menu; search, filter and the
/// account avatar sit on the trailing edge. The Agent page brings its own composer.
struct HomeView: View {
    @Environment(AuthSession.self) private var session
    let user: NuphosUser

    @State private var page: HomePage = Self.initialPage
    /// The viewer picked a page, so the default tab no longer applies. A
    /// DEBUG `-page` launch argument is a pick too.
    @State private var pageChosen = CommandLine.arguments.contains("-page")
    /// The next page change is the default tab, not the viewer's pick.
    @State private var autoPage = false
    @State private var showProfile = false
    @State private var isSearching = false
    @State private var titleCollapsed = false
    @State private var store: AgentStore?
    @State private var plans: PlansStore?
    @State private var connectors: ConnectorsStore?
    /// The selected team's open questions: the Inbox page and its badge.
    @State private var inbox: OpenQuestions?
    @State private var openChat: AgentPage.OpenChat?
    /// A desktop shows beside the open conversation, with the list put away meanwhile.
    @State private var desktopOpen = false
    private var columns: Binding<NavigationSplitViewVisibility> { NavigationSplitViewVisibility.home(desktopOpen: desktopOpen) }
    private var desktopBeside: ((Bool) -> Void)? {
        guard sizeClass == .regular else { return nil }
        return { open in desktopOpen = open }
    }
    /// The window's, not a column's: a split view's columns report compact.
    @Environment(\.horizontalSizeClass) private var sizeClass
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
            // The page switcher sits in the bar, on the same row as search,
            // filter and the account avatar.
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            // Wide, the list always stays: there is nothing to put it away with.
            .toolbar(removing: .sidebarToggle)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    PageTitleMenu(selection: $page, style: .bar, inboxCount: inbox?.list.count ?? 0)
                }
                .sharedBackgroundHidden()

                // Each control gets its own glass group
                // (ToolbarSpacer(.fixed) splits groups, per the toolbar docs).
                if page.isHomeList, store != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            isSearching.toggle()
                        } label: {
                            Label("Search agents", systemImage: "magnifyingglass")
                        }
                    }
                    GlassGroupSpacer()
                }
                // The avatar draws its own circular glass: the system glass
                // for a non-icon label is a capsule, not a circle.
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showProfile = true
                    } label: {
                        AvatarView(user: user, size: 30)
                            .padding(7)
                            .glass(interactive: true, in: Circle())
                    }
                    .buttonStyle(.plain)
                    #if os(iOS)
                    .hoverEffect()
                    #endif
                    .accessibilityLabel("Account")
                }
                .sharedBackgroundHidden()
            }
            #if DEBUG
            .onAppear { if ProcessInfo.processInfo.arguments.contains("-show-app-icons") { showProfile = true } }
            #endif
            .sheet(isPresented: $showProfile) {
                ProfileSheet(user: user)
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
            ZStack {
                if let channel = openChat?.channel {
                    ChannelView(channel: channel)
                        .id(channel.channelId)
                        .toolbar { newAgentItem }
                } else if let openChat, let chatSession = openChat.session {
                    ConversationView(session: chatSession, initialPrompt: openChat.prompt)
                        .id(openChat.id)
                        // A link to a chat opens as a session until its kind is known.
                        .onChange(of: chatSession.isChannel) { _, isChannel in
                            guard isChannel, let store else { return }
                            self.openChat = AgentPage.OpenChat(channel: store.channel(
                                sessionId: chatSession.sessionId, title: chatSession.title, teamId: chatSession.teamId))
                        }
                        // Compact pops back to the list's composer; wide has
                        // no back, so this returns the column to it.
                        .toolbar { newAgentItem }
                } else if page == .agent, store != nil, sizeClass == .regular {
                    Theme.chatCanvas.ignoresSafeArea()
                        .safeAreaInset(edge: .bottom, spacing: 0) {
                            NewChatComposer(openChat: $openChat).readableWidth()
                        }
                } else {
                    Theme.canvas.ignoresSafeArea()
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
            openChat = nil
        }
        .onChange(of: page) { oldPage, newPage in
            if autoPage { autoPage = false } else { pageChosen = true }
            isSearching = false
            openChat = nil
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
        .onChange(of: store?.selectedTeam?.id) { _, teamID in
            Analytics.shared.screen(page.rawValue, teamID: teamID)
        }
        .onChange(of: PushNotifications.shared.pendingTarget, initial: true) { _, target in
            if target != nil, !page.isHomeList { page = .agent }
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

    /// Compact pops back to the list's composer; wide has no back, so this
    /// returns the column to it.
    @ToolbarContentBuilder
    private var newAgentItem: some ToolbarContent {
        if sizeClass == .regular {
            ToolbarItem(placement: .topBarLeading) {
                Button("New task", systemImage: "square.and.pencil") { openChat = nil }
            }
        }
    }

    /// DEBUG: `-page runtimes` opens that page directly, for UI checks.
    private static var initialPage: HomePage {
        #if DEBUG
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "-page"), i + 1 < args.count, let page = HomePage(rawValue: args[i + 1]) {
            return page
        }
        #endif
        return HomePage.hasChats ? .chats : .agent
    }

    @ViewBuilder
    private var pageContent: some View {
        switch page {
        case .chats, .agent:
            AgentPage(page: $page, isSearching: $isSearching, titleCollapsed: $titleCollapsed, openChat: $openChat, showsComposer: sizeClass != .regular)
        case .inbox:
            InboxPage(inbox: inbox)
                .onAppear { titleCollapsed = false }
        case .connectors:
            ConnectorsPage()
                .onAppear { titleCollapsed = false }
        case .runtimes:
            RuntimesPage()
                .onAppear { titleCollapsed = false }
        }
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

private extension ToolbarContent {
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
        CredentialCatalog.providers.map(\.logo) + ["logo-claude", "logo-openai", "logo-grok", "logo-antigravity", "logo-opencode"]
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
