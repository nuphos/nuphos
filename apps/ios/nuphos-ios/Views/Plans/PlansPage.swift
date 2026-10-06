import SwiftUI

/// The Plans library: every plan the agent proposed for the selected team,
/// newest first, with the approval policy strip above. Port of the desktop
/// `PlansView` — dismissed plans hidden by default, client-side search,
/// silent refresh while visible.
struct PlansPage: View {
    @Environment(AgentStore.self) private var store
    @Environment(PlansStore.self) private var plans
    @Binding var page: HomePage
    /// Driven by the search button in the toolbar.
    @Binding var isSearching: Bool
    /// True once the large header has scrolled under the bar.
    @Binding var titleCollapsed: Bool

    @State private var unplanTarget: Plan?
    @State private var chatTarget: PlanChatTarget?
    @State private var newChat: AgentPage.NewChat?
    @State private var showPolicy = false

    var body: some View {
        @Bindable var plans = plans

        content
            .safeAreaInset(edge: .top, spacing: 0) {
                if isSearching {
                    SearchBar(text: $plans.search, placeholder: "Search plans") {
                        plans.search = ""
                        isSearching = false
                    }
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(.snappy(duration: 0.25), value: isSearching)
            .navigationDestination(for: PlanRoute.self) { route in
                PlanDetailView(planId: route.planId)
            }
            .navigationDestination(item: $chatTarget) { target in
                PlanConversationView(target: target)
            }
            .navigationDestination(item: $newChat) { chat in
                ConversationView(session: chat.session, initialPrompt: chat.prompt, sourcePage: HomePage.plans.rawValue)
                    .onDisappear { Task { await plans.reload() } }
            }
            .sheet(isPresented: $showPolicy) {
                PlanApprovalPolicySheet()
            }
            .confirmationDialog(
                unplanTarget.map { "Mark plan \($0.displayNumber) as unplanned?" } ?? "",
                isPresented: Binding(get: { unplanTarget != nil }, set: { if !$0 { unplanTarget = nil } }),
                titleVisibility: .visible
            ) {
                Button("Mark as unplanned", role: .destructive) {
                    if let plan = unplanTarget { Task { await plans.markUnplanned(plan) } }
                    unplanTarget = nil
                }
                Button("Cancel", role: .cancel) { unplanTarget = nil }
            } message: {
                Text("The plan is kept for reference but will no longer be run.")
            }
            .alert("Something went wrong", isPresented: Binding(get: { plans.actionError != nil }, set: { if !$0 { plans.actionError = nil } })) {
                Button("OK") { plans.actionError = nil }
            } message: {
                Text(plans.actionError ?? "")
            }
            .task {
                if store.teams.isEmpty { await store.loadTeams() }
            }
            .task(id: store.selectedTeam?.id) {
                await plans.use(teamId: store.selectedTeam?.id)
            }
            .task {
                // The desktop's silent tick, while the page is on screen.
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(10))
                    await plans.silentRefresh()
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch plans.phase {
        case .loaded where !plans.rows.isEmpty:
            list
        default:
            ScrollView {
                VStack(spacing: 0) {
                    if plans.phase == .loaded { policyStrip.padding(.horizontal, 20) }
                    status
                        .containerRelativeFrame(.vertical) { height, _ in height * 0.75 }
                }
            }
            .background(Theme.canvas)
            .onAppear { titleCollapsed = false }
            .refreshable { await plans.reload() }
        }
    }

    @ViewBuilder
    private var status: some View {
        if case .failed(let message) = store.teamsPhase, store.teams.isEmpty {
            ContentUnavailableView {
                Label("Couldn't load teams", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try again") { Task { await store.loadTeams() } }
                    .buttonStyle(.borderedProminent)
            }
        } else {
            phaseStatus
        }
    }

    @ViewBuilder
    private var phaseStatus: some View {
        switch plans.phase {
        case .idle, .loading:
            ProgressView("Loading plans…")
                .tint(Theme.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn't load plans", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try again") { Task { await plans.reload() } }
                    .buttonStyle(.borderedProminent)
            }
        case .loaded where !plans.search.trimmingCharacters(in: .whitespaces).isEmpty:
            ContentUnavailableView.search(text: plans.search)
        case .loaded where plans.plans.isEmpty:
            ContentUnavailableView {
                Label("Plans", systemImage: "list.bullet.clipboard")
            } description: {
                Text("When you ask the agent to do something that needs confirmation, it drafts a plan here for the team to review and approve. Plans are shared, so anyone with access can weigh in.")
            } actions: {
                Button("Ask the agent to plan a change") {
                    if let session = store.newSession() {
                        newChat = AgentPage.NewChat(session: session, prompt: ComposerSubmission(
                            text: "Help me plan a change — ask me what I want to do, then draft a plan for the team to review.",
                            attachments: []
                        ))
                    }
                }
                .buttonStyle(.borderedProminent)
            }
        case .loaded:
            // Everything loaded is dismissed and hidden.
            ContentUnavailableView {
                Label("No plans to show", systemImage: "list.bullet.clipboard")
            } description: {
                Text("Dismissed plans are hidden.")
            } actions: {
                Button("Show dismissed") { plans.showDismissed = true }
                    .buttonStyle(.bordered)
            }
        }
    }

    private var list: some View {
        List {
            policyStrip
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 8, trailing: 16))

            Section {
                ForEach(plans.rows) { plan in
                    NavigationLink(value: PlanRoute(planId: plan.id)) {
                        PlanRow(plan: plan, creator: plans.member(plan.createdBy))
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 12, leading: 20, bottom: 12, trailing: 16))
                    .listSectionSeparator(.hidden, edges: .top)
                    .contextMenu { rowMenu(plan) }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        if plan.isCancellable {
                            Button { unplanTarget = plan } label: {
                                Label("Unplan", systemImage: "nosign")
                            }
                            .tint(.red)
                        }
                    }
                }

                if plans.hasMore, plans.search.isEmpty {
                    HStack {
                        Spacer()
                        ProgressView().tint(Theme.muted)
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                    .task { await plans.loadMore() }
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
        .refreshable { await plans.reload() }
    }

    /// The desktop's approval-policy banner; Configure is for administrators.
    private var policyStrip: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.shield")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.brandText)
            Text("Plan approval")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.body)
            Text(plans.approvalPolicy?.summary ?? (plans.phase == .loaded ? "Not available" : "Loading…"))
                .font(.system(size: 13))
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
            Spacer(minLength: 8)
            if store.selectedTeam?.isAdministrator == true, plans.approvalPolicy != nil {
                Button("Configure") { showPolicy = true }
                    .font(.system(size: 13, weight: .medium))
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .tint(Theme.brandText)
            }
        }
        .padding(.vertical, 6)
    }

    @ViewBuilder
    private func rowMenu(_ plan: Plan) -> some View {
        if let target = PlanChatTarget(plan: plan) {
            Button { chatTarget = target } label: {
                Label(target.buttonTitle, systemImage: "bubble.left")
            }
        }
        if plan.isCancellable {
            Divider()
            Button(role: .destructive) { unplanTarget = plan } label: {
                Label("Mark as unplanned", systemImage: "nosign")
            }
        }
    }
}

/// Navigation value for a plan's detail page.
struct PlanRoute: Hashable {
    let planId: String
}

/// "Continue in chat" / "Open in chat": the conversation a plan was
/// proposed in. Legacy plans without one get no button, like the desktop.
struct PlanChatTarget: Identifiable, Hashable {
    let planId: String
    let sessionId: String
    let title: String
    /// Sent once the conversation has loaded — for a plan whose approval
    /// gate is met but that the agent has not started yet.
    let proceedMessage: String?
    let buttonTitle: LocalizedStringKey

    var id: String { planId + sessionId }

    init?(plan: Plan) {
        guard let sessionId = plan.sourceConversationId, !sessionId.isEmpty else { return nil }
        planId = plan.id
        self.sessionId = sessionId
        title = plan.title
        switch plan.status {
        case "proposed":
            proceedMessage = nil
            buttonTitle = "Continue in chat"
        case "approved":
            proceedMessage = "Approved plan #\(plan.id) — please proceed with plan #\(plan.id)."
            buttonTitle = "Continue in chat"
        default:
            proceedMessage = nil
            buttonTitle = "Open in chat"
        }
    }

    static func == (a: PlanChatTarget, b: PlanChatTarget) -> Bool { a.id == b.id && a.proceedMessage == b.proceedMessage }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// Owns the `ChatSession` for a plan's source conversation.
struct PlanConversationView: View {
    @Environment(AgentStore.self) private var store
    @Environment(PlansStore.self) private var plans
    let target: PlanChatTarget
    @State private var session: ChatSession?

    var body: some View {
        Group {
            if let session {
                ConversationView(session: session, sourcePage: HomePage.plans.rawValue)
            } else {
                Theme.canvas
            }
        }
        .onAppear {
            guard session == nil else { return }
            let s = store.session(sessionId: target.sessionId, title: target.title)
            s.sendAfterLoad = target.proceedMessage
            session = s
        }
        .onDisappear { Task { await plans.silentRefresh() } }
    }
}

#Preview {
    @Previewable @State var searching = false
    @Previewable @State var page = HomePage.plans
    @Previewable @State var collapsed = false
    NavigationStack {
        PlansPage(page: $page, isSearching: $searching, titleCollapsed: $collapsed)
    }
    .environment(AgentStore(token: ""))
    .environment(PlansStore(token: ""))
}
