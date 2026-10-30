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
    @State private var showAgentSetup = false
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
        let session: ChatSession
        var prompt: ComposerSubmission?
        var id: String { session.sessionId }
        static func == (a: OpenChat, b: OpenChat) -> Bool { a.id == b.id }
        func hash(into hasher: inout Hasher) { hasher.combine(id) }
    }

    var body: some View {
        @Bindable var store = store

        content
            // On the switch, so the empty and error states refresh too.
            .refreshable {
                if store.selectedTeam == nil { await store.loadTeams() } else { await store.reload() }
            }
            .sheet(isPresented: $showWorkspaceSetup) { WorkspaceSetupSheet() }
            .sheet(isPresented: $showAgentSetup) { if let team = store.selectedTeam { AgentSetupSheet(team: team) } }
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
                if showsComposer { NewChatComposer(openChat: $openChat) }
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
                if CommandLine.arguments.contains("-show-agent-setup") { showAgentSetup = true }
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

    private func openPushTarget() {
        guard let target = PushNotifications.shared.pendingTarget, store.teamsPhase == .loaded else { return }
        PushNotifications.shared.pendingTarget = nil
        // The chat on screen already has this session loaded. A new session
        // with the same id keeps the view's identity, so it would never load.
        guard target.sessionId != openChat?.id else { return }
        if let team = store.teams.first(where: { $0.id == target.teamId }) { store.select(team: team) }
        endEditing()
        openChat = OpenChat(session: store.session(sessionId: target.sessionId, title: target.title, teamId: target.teamId))
    }

    @ViewBuilder
    private var content: some View {
        switch store.phase {
        case .loaded where !store.listedConversations.isEmpty:
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
                Text(store.selectedTeam?.isAdministrator == true ? "Create a cloud runtime and sign in with your AI provider." : "Ask a workspace administrator to connect a cloud runtime, or open Nuphos on your computer to connect your own local runtime.")
            } actions: {
                if store.selectedTeam?.isAdministrator == true {
                    Button("Set up runtime") { showAgentSetup = true }.prominentButton()
                }
            }
        case .idle, .loading:
            ProgressView("Loading agents…")
                .tint(Theme.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn't load agents", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try again") { Task { await store.loadTeams() } }
                    .prominentButton()
            }
        case .loaded where store.listedConversations.isEmpty:
            ContentUnavailableView {
                Label(store.search.isEmpty ? "No agents yet" : "No matches", systemImage: "message")
            } description: {
                Text(store.search.isEmpty ? "Start an agent from the bar below." : "No agents match your search.")
            }
        case .loaded:
            EmptyView()
        }
    }

    @ViewBuilder
    private func rowActions(_ conversation: AgentConversation) -> some View {
        if conversation.canManage { Button {
            Task { await store.archive(sessionId: conversation.sessionId, teamId: conversation.teamId) }
        } label: {
            Label("Archive", systemImage: "archivebox")
        }
        .tint(.orange) }
        Button {
            Task { try? await store.setPinned(!store.isPinned(conversation.sessionId), sessionId: conversation.sessionId, title: conversation.displayTitle) }
        } label: {
            Label(store.isPinned(conversation.sessionId) ? "Unpin" : "Pin", systemImage: store.isPinned(conversation.sessionId) ? "pin.slash" : "pin")
        }
        .tint(.indigo)
        if let watching = conversation.watching {
            Button {
                Task { await store.setWatching(!watching, conversation: conversation) }
            } label: {
                Label(watching ? "Unwatch" : "Watch", systemImage: watching ? "bell.slash" : "bell")
            }
            .tint(.teal)
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
            openChat = store.listedConversations.first { $0.sessionId == id }.map { OpenChat(session: store.session(for: $0)) }
        }
    }

    private var list: some View {
        List(selection: selection) {
            Section {
                ForEach(store.nestedConversations) { item in
                    let conversation = item.conversation
                    let folded = item.hasChildren && store.isFolded(conversation.sessionId)
                    NavigationLink(value: conversation.sessionId) {
                        HStack(spacing: 0) {
                            ConversationRow(
                                conversation: conversation, pinned: store.isPinned(conversation.sessionId), hidden: item.hidden
                            )
                            if item.hasChildren {
                                // The thread count, so it never reads as the row's own disclosure chevron.
                                Button { store.toggleFolded(conversation.sessionId) } label: {
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
                        }
                        // Insets live here, not on the row, so the tree lines span the whole row.
                        .padding(.leading, CGFloat(item.depth) * ThreadTree.indent)
                        .padding(.vertical, 12)
                        .background(alignment: .leading) {
                            ThreadTree(trail: item.trail, expanded: item.hasChildren && !folded)
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 16))
                    .listSectionSeparator(.hidden, edges: .top)
                    // A separator would cut through the lines of an open tree.
                    .listRowSeparator(item.depth > 0 || (item.hasChildren && !folded) ? .hidden : .automatic)
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) { rowActions(conversation) }
                    // The same actions for a long press or a secondary click.
                    .contextMenu { rowActions(conversation) }
                }

                if store.hasMore {
                    HStack {
                        Spacer()
                        ProgressView().tint(Theme.muted)
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                    .task { await store.loadMore() }
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
    }
}

/// The expandable search field under the navigation bar. The owning store
/// decides whether the query is server-backed (chats) or local (plans).
struct SearchBar: View {
    @Binding var text: String
    var placeholder: LocalizedStringKey = "Search agents"
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
            .glassEffect(.regular, in: Capsule())

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
    @State private var draft = ""

    private var draftTeam: String { store.selectedTeam?.id ?? "" }

    var body: some View {
        @Bindable var store = store
        ChatComposerBar(text: $draft, canSend: !store.selectedRuntimeUnavailable && !store.newModelSaving && store.credentialsReady, mentions: draftTeam.isEmpty ? nil : MentionSource(
            teamId: draftTeam,
            devices: store.credentialCatalog?.scoped(to: .devices).allItems ?? [],
            pickDevice: { device in
                if !store.credentialSelection.contains(device) { store.credentialSelection.toggle(device) }
            },
            search: { query in
                await store.loadCredentialOptions()
                return await store.mentionableSessions(teamId: draftTeam, excluding: nil, matching: query)
            }
        ), voiceTeamId: draftTeam.isEmpty ? nil : draftTeam, onSend: { submission in
            guard let session = store.newSession() else { return }
            endEditing()
            openChat = AgentPage.OpenChat(session: session, prompt: submission)
        }) {
            ComposerControls(selection: $store.credentialSelection, mode: $store.permissionMode, session: nil)
        }
        .onAppear {
            if draft.isEmpty { draft = ComposerDrafts.text(team: draftTeam, session: "new") }
        }
        .onChange(of: store.selectedTeam?.id) { old, new in
            draft = ComposerDrafts.switchTeam(visible: draft, session: "new", from: old ?? "", to: new ?? "")
        }
        .onChange(of: draft) { _, text in
            ComposerDrafts.set(text, team: draftTeam, session: "new")
        }
    }
}

/// Puts the list's keyboard away before a chat opens. UIKit remembers the
/// focus a pushed chat covered and hands it back when a back swipe starts,
/// raising a keyboard that lifts the chat's composer mid-swipe.
private func endEditing() {
    #if canImport(UIKit)
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    #endif
}
