import SwiftUI

/// The signed-in shell: the page name is the (large) navigation title and
/// doubles as the page switcher via the title menu; search, filter and the
/// account avatar sit on the trailing edge. The Agent page brings its own composer.
struct HomeView: View {
    @Environment(AuthSession.self) private var session
    let user: NuphosUser

    @State private var page: HomePage = Self.initialPage
    @State private var showProfile = false
    @State private var isSearching = false
    @State private var titleCollapsed = false
    @State private var store: AgentStore?
    @State private var plans: PlansStore?
    @State private var connectors: ConnectorsStore?
    @State private var openChat: AgentPage.OpenChat?
    @State private var columns = NavigationSplitViewVisibility.automatic
    /// The window's, not a column's: a split view's columns report compact.
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        // Collapses to a single stack when compact; side by side when wide,
        // such as iPhone Duo's inner display and iPad.
        NavigationSplitView(columnVisibility: $columns) {
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
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    PageTitleMenu(selection: $page, style: .bar)
                }
                .sharedBackgroundVisibility(.hidden)

                // Each control gets its own glass group
                // (ToolbarSpacer(.fixed) splits groups, per the toolbar docs).
                if page == .agent, store != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            isSearching.toggle()
                        } label: {
                            Label("Search agents", systemImage: "magnifyingglass")
                        }
                    }
                    ToolbarSpacer(.fixed, placement: .topBarTrailing)
                }
                if page == .plans, let plans {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            isSearching.toggle()
                        } label: {
                            Label("Search plans", systemImage: "magnifyingglass")
                        }
                    }
                    ToolbarSpacer(.fixed, placement: .topBarTrailing)
                    ToolbarItem(placement: .topBarTrailing) {
                        PlansFilterMenu()
                            .environment(plans)
                    }
                    ToolbarSpacer(.fixed, placement: .topBarTrailing)
                }

                // The avatar draws its own circular glass: the system glass
                // for a non-icon label is a capsule, not a circle.
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showProfile = true
                    } label: {
                        AvatarView(user: user, size: 30)
                            .padding(7)
                            .glassEffect(.regular.interactive(), in: Circle())
                    }
                    .buttonStyle(.plain)
                    #if os(iOS)
                    .hoverEffect()
                    #endif
                    .accessibilityLabel("Account")
                }
                .sharedBackgroundVisibility(.hidden)
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
                if let openChat {
                    ConversationView(session: openChat.session, initialPrompt: openChat.prompt)
                        .id(openChat.id)
                        // Compact pops back to the list's composer; wide has
                        // no back, so this returns the column to it.
                        .toolbar {
                            if sizeClass == .regular {
                                ToolbarItem(placement: .topBarLeading) {
                                    Button("New agent", systemImage: "square.and.pencil") { self.openChat = nil }
                                }
                            }
                        }
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
        // On the split view itself, so the detail column and pushed
        // destinations see the store too — not only pageContent.
        .environment(store)
        .environment(plans)
        .environment(connectors)
        // Wide, a conversation shows its desktop beside it, with the list put away meanwhile.
        .environment(\.desktopBeside, sizeClass == .regular ? { open in columns = open ? .detailOnly : .automatic } : nil)
        .tint(Theme.heading)
        .animation(.easeOut(duration: 0.2), value: titleCollapsed)
        .onAppear {
            var token = session.token
            #if DEBUG
            if token == nil, CommandLine.arguments.contains("-preview-home") { token = "" }
            #endif
            if store == nil, let token {
                store = AgentStore(token: token)
                store?.me = ChatMessage.Sender(name: user.name, avatarURL: user.avatarURL)
                store?.userId = user.id
                plans = PlansStore(token: token)
                connectors = ConnectorsStore(token: token)
            }
        }
        .focusedSceneValue(\.newChat) {
            page = .agent
            openChat = nil
        }
        .onChange(of: page) { oldPage, newPage in
            isSearching = false
            openChat = nil
            UIEventLog.pageTransition(from: oldPage.rawValue, to: newPage.rawValue)
            Analytics.shared.screen(newPage.rawValue, teamID: store?.selectedTeam?.id)
        }
        .onChange(of: store?.selectedTeam?.id) { _, teamID in
            Analytics.shared.screen(page.rawValue, teamID: teamID)
        }
        .onChange(of: PushNotifications.shared.pendingTarget, initial: true) { _, target in
            if target != nil { page = .agent }
        }
        .onChange(of: PushNotifications.shared.pendingConversations, initial: true) { _, show in
            guard show else { return }
            PushNotifications.shared.pendingConversations = false
            page = .agent
            openChat = nil
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
        return .agent
    }

    @ViewBuilder
    private var pageContent: some View {
        switch page {
        case .agent:
            AgentPage(page: $page, isSearching: $isSearching, titleCollapsed: $titleCollapsed, openChat: $openChat, showsComposer: sizeClass != .regular)
        case .plans:
            PlansPage(page: $page, isSearching: $isSearching, titleCollapsed: $titleCollapsed)
        case .connectors:
            ConnectorsPage()
                .onAppear { titleCollapsed = false }
        case .runtimes:
            RuntimesPage()
                .onAppear { titleCollapsed = false }
        }
    }
}

/// Whether the Plans list reveals dismissed (rejected / unplanned) plans.
private struct PlansFilterMenu: View {
    @Environment(PlansStore.self) private var plans

    var body: some View {
        @Bindable var plans = plans
        Menu {
            Toggle(isOn: $plans.showDismissed) {
                Label("Show dismissed", systemImage: "nosign")
            }
        } label: {
            Label("Filter plans", systemImage: plans.showDismissed
                  ? "line.3.horizontal.decrease.circle.fill"
                  : "line.3.horizontal.decrease")
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
