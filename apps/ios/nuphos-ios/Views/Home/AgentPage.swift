import SwiftUI

/// The Agent page: the conversation history for the selected team, with
/// the composer capsule pinned to the bottom.
struct AgentPage: View {
    @Environment(AgentStore.self) private var store
    @Binding var page: HomePage
    /// Driven by the search button in the toolbar.
    @Binding var isSearching: Bool
    /// True once the large header has scrolled under the bar.
    @Binding var titleCollapsed: Bool

    @State private var draft = ""
    @State private var showWorkspaceSetup = false
    @State private var showAgentSetup = false
    #if DEBUG
    /// `-preview-agent-login`: the authorization-code step with a canned attempt.
    @State private var previewLogin = false
    #endif
    /// A chat started from the composer here.
    @State private var newChat: NewChat?
    /// DEBUG `-open-first-chat`: pushes the first conversation once loaded.
    @State private var autoOpened: AgentConversation?
    #if DEBUG
    @State private var didHandleLaunchAction = false
    #endif
    /// A chat opened from a tapped notification.
    @State private var pushOpen: PushTarget?

    struct NewChat: Identifiable, Hashable {
        let id = UUID()
        let session: ChatSession
        let prompt: ComposerSubmission
        static func == (a: NewChat, b: NewChat) -> Bool { a.id == b.id }
        func hash(into hasher: inout Hasher) { hasher.combine(id) }
    }

    private var draftTeam: String { store.selectedTeam?.id ?? "" }

    var body: some View {
        @Bindable var store = store

        content
            .sheet(isPresented: $showWorkspaceSetup) { WorkspaceSetupSheet() }
            .sheet(isPresented: $showAgentSetup) { if let team = store.selectedTeam { AgentSetupSheet(team: team) } }
            #if DEBUG
            .sheet(isPresented: $previewLogin) {
                if let team = store.selectedTeam {
                    AgentSetupSheet(
                        team: team,
                        runtime: RuntimeInstance(id: "preview", provider: .claudeCode, label: "Claude Code", status: .active, kind: "managed", local: nil, defaults: nil),
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
                ChatComposerBar(text: $draft, canSend: !store.selectedRuntimeUnavailable && !store.newModelSaving, onSend: { submission in
                    if let session = store.newSession() { newChat = NewChat(session: session, prompt: submission) }
                }) {
                    ComposerControls(selection: $store.credentialSelection, mode: $store.permissionMode, session: nil)
                }
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
            .navigationDestination(for: AgentConversation.self) { conversation in
                ExistingConversationView(conversation: conversation)
            }
            .navigationDestination(item: $newChat) { chat in
                ConversationView(session: chat.session, initialPrompt: chat.prompt)
                    .onDisappear { Task { await store.reload() } }
            }
            .navigationDestination(item: $autoOpened) { conversation in
                ExistingConversationView(conversation: conversation)
            }
            .navigationDestination(item: $pushOpen) { target in
                PushedConversationView(target: target).id(target.id)
            }
            .onChange(of: store.teamsPhase) { _, phase in if phase == .loaded { openPushTarget() } }
            .onChange(of: PushNotifications.shared.pendingTarget) { _, _ in openPushTarget() }
            .task {
                await store.loadTeams()
                openPushTarget()
                #if DEBUG
                // Returning from a destination starts this task again. Launch
                // actions must not reopen chats (or resend a preview prompt).
                guard !didHandleLaunchAction, !Task.isCancelled else { return }
                didHandleLaunchAction = true
                if CommandLine.arguments.contains("-open-first-chat") {
                    autoOpened = store.conversations.first
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
                    tool.authorization = .object(["decision": .string("require_auth"), "reason": .string("OpenAB requested permission before running this tool.")])
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
                    newChat = NewChat(session: session, prompt: ComposerSubmission(text: "", attachments: []))
                }
                // `-new-chat "<prompt>"`: start a conversation with that text.
                let args = CommandLine.arguments
                if let i = args.firstIndex(of: "-new-chat"), i + 1 < args.count, let session = store.newSession() {
                    newChat = NewChat(session: session, prompt: ComposerSubmission(text: args[i + 1], attachments: []))
                }
                #endif
            }
    }

    private func openPushTarget() {
        guard let target = PushNotifications.shared.pendingTarget, store.teamsPhase == .loaded else { return }
        PushNotifications.shared.pendingTarget = nil
        if let team = store.teams.first(where: { $0.id == target.teamId }) { store.select(team: team) }
        pushOpen = target
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
                Button("Set up workspace") { showWorkspaceSetup = true }.buttonStyle(.borderedProminent)
            }
        case .loaded where store.runtimesLoaded && store.runtimes.isEmpty:
            ContentUnavailableView {
                Label("Connect your first agent", systemImage: "cpu")
            } description: {
                Text(store.selectedTeam?.isAdministrator == true ? "Create a cloud agent and sign in with your AI provider." : "Ask a workspace administrator to connect a cloud agent, or open Nuphos on your computer to connect your own local agent.")
            } actions: {
                if store.selectedTeam?.isAdministrator == true {
                    Button("Set up agent") { showAgentSetup = true }.buttonStyle(.borderedProminent)
                }
            }
        case .idle, .loading:
            ProgressView("Loading chats…")
                .tint(Theme.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn't load chats", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try again") { Task { await store.loadTeams() } }
                    .buttonStyle(.borderedProminent)
            }
        case .loaded where store.listedConversations.isEmpty:
            ContentUnavailableView {
                Label(store.search.isEmpty ? (store.showArchived ? "No archived chats" : "No chats yet") : "No matches", systemImage: store.showArchived ? "archivebox" : "message")
            } description: {
                Text(store.search.isEmpty
                     ? (store.showArchived ? "Idle chats are archived automatically after a week." : "Start a conversation from the bar below.")
                     : "No conversations match your search.")
            }
        case .loaded:
            EmptyView()
        }
    }

    private var list: some View {
        List {
            Section {
                ForEach(store.listedConversations) { conversation in
                    NavigationLink(value: conversation) {
                        ConversationRow(conversation: conversation, pinned: store.isPinned(conversation.sessionId))
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 12, leading: 20, bottom: 12, trailing: 16))
                    .listSectionSeparator(.hidden, edges: .top)
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        if conversation.canManage { Button {
                            Task { await store.setArchived(!conversation.isArchived, conversation: conversation) }
                        } label: {
                            Label(conversation.isArchived ? "Restore" : "Archive", systemImage: conversation.isArchived ? "tray.and.arrow.up" : "archivebox")
                        }
                        .tint(conversation.isArchived ? .blue : .orange) }
                        Button {
                            Task { try? await store.setPinned(!store.isPinned(conversation.sessionId), sessionId: conversation.sessionId, title: conversation.displayTitle) }
                        } label: {
                            Label(store.isPinned(conversation.sessionId) ? "Unpin" : "Pin", systemImage: store.isPinned(conversation.sessionId) ? "pin.slash" : "pin")
                        }
                        .tint(.indigo)
                    }
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
        .refreshable { await store.reload() }
        .onAppear { store.startPolling() }
        .task {
            while !Task.isCancelled {
                RuntimeObservations.shared.tick()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }
}

/// The expandable search field under the navigation bar. The owning store
/// decides whether the query is server-backed (chats) or local (plans).
struct SearchBar: View {
    @Binding var text: String
    var placeholder: LocalizedStringKey = "Search chats"
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
        AgentPage(page: $page, isSearching: $searching, titleCollapsed: $collapsed)
    }
    .environment(AgentStore(token: ""))
}

/// A pinned chat that may not be in the loaded page: known by id only.
/// A conversation opened from a notification, which may belong to another team.
private struct PushedConversationView: View {
    @Environment(AgentStore.self) private var store
    let target: PushTarget
    @State private var session: ChatSession?

    var body: some View {
        Group {
            if let session {
                ConversationView(session: session)
            } else {
                Theme.canvas
            }
        }
        .onAppear { if session == nil { session = store.session(sessionId: target.sessionId, title: target.title, teamId: target.teamId) } }
        .onDisappear { Task { await store.reload() } }
    }
}

/// Owns the `ChatSession` for a pushed conversation so it survives view
/// updates while the row's data stays a plain value.
private struct ExistingConversationView: View {
    @Environment(AgentStore.self) private var store
    let conversation: AgentConversation
    @State private var session: ChatSession?

    var body: some View {
        Group {
            if let session {
                ConversationView(session: session)
            } else {
                Theme.canvas
            }
        }
        .onAppear { if session == nil { session = store.session(for: conversation) } }
        .onDisappear { Task { await store.reload() } }
    }
}
