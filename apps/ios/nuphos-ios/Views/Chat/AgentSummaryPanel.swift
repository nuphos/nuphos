import SwiftUI

/// Conversation context, read through the same APIs as Desktop's Agent summary.
/// It never asks a desktop device for its tabs or navigation history.
struct AgentSummaryPanel: View {
    @Bindable var session: ChatSession
    let close: () -> Void
    let archive: () -> Void
    /// Shown first: a Bot's details lead with the Bot's card, and are laid out
    /// as Desktop's Bot details (#2983).
    var lead: AnyView?
    let openSession: (AgentConversation) -> Void
    @Environment(AgentStore.self) private var store
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var questions: OpenQuestions?
    @State private var triggers: [ConversationTrigger] = []
    @State private var triggersFailed = false
    @State private var loading = true
    @State private var showTriggers = false
    @State private var selectedQuestion: BotQuestion?

    private var children: [AgentConversation] { store.tasks(under: session.sessionId, team: session.teamId) }
    private var isBotDetails: Bool { lead != nil }
    private var title: LocalizedStringKey { isBotDetails ? "Bot details" : "Task summary" }
    private var pending: [BotQuestion] {
        let ids = Set([session.sessionId] + children.map(\.sessionId))
        return questions?.list.filter { ids.contains($0.sessionId) } ?? []
    }
    private var changes: [SessionResource] {
        session.resources.filter { $0.provider == "github" || $0.provider == "linear" }
    }
    private var background: [SummaryBackgroundWork] {
        SummaryBackgroundWork.items(session.runtimeObservation?.snapshot)
    }
    private var hasContent: Bool {
        !pending.isEmpty || !changes.isEmpty || !children.isEmpty || !background.isEmpty
            || !triggers.isEmpty || !session.downloads.isEmpty
    }

    var body: some View {
        NavigationStack {
            ScrollView {
              VStack(alignment: .leading, spacing: 16) {
                if let lead { lead }
                if !isBotDetails || !pending.isEmpty {
                SummaryCard("Needs your input") {
                    if pending.isEmpty {
                        Text("No questions waiting for you.").foregroundStyle(Theme.body)
                    } else {
                        ForEach(pending) { question in
                            Button { selectedQuestion = question } label: {
                                summaryRow(question.request.question, subtitle: question.title, icon: "circle-help")
                            }
                        }
                    }
                }
                }
                if !session.isBot && !isBotDetails {
                  SummaryCard("Task actions") {
                    Button(action: archive) {
                        Label { Text("Archive") } icon: { LucideIcon("archive") }
                    }
                    .buttonStyle(.bordered)
                    .disabled(session.isArchived || !session.canArchive)
                  }
                }
                if !background.isEmpty {
                    SummaryCard("Background tasks") {
                        ForEach(background) { work in
                            DisclosureGroup {
                                if !work.output.isEmpty {
                                    Text(work.output).font(.caption.monospaced()).textSelection(.enabled)
                                } else {
                                    Text("Running").foregroundStyle(Theme.body)
                                }
                            } label: { summaryRow(work.title, subtitle: "Running", icon: "terminal") }
                        }
                    }
                }
                if !changes.isEmpty {
                    SummaryCard("Changes") {
                        ForEach(changes) { resource in
                            Link(destination: resource.url) {
                                summaryRow(resource.title, subtitle: "\(resource.chip) · \(resource.state)", icon: "git-pull-request")
                            }
                        }
                    }
                }
                if !children.isEmpty {
                    SummaryCard("Sub-tasks") {
                        ForEach(children) { child in
                            Button { openSession(child) } label: {
                                if isBotDetails {
                                    BotTaskRow(task: child, state: store.indicator(for: child, team: session.teamId))
                                } else {
                                    summaryRow(child.displayTitle, subtitle: state(child), icon: "layers")
                                }
                            }.buttonStyle(.plain).accessibilityIdentifier("summary.task")
                        }
                    }
                }
                if !session.downloads.isEmpty {
                    SummaryCard("Files") {
                        ForEach(session.downloads, id: \.groupId) { group in
                            TransferCard(groupIds: [group.groupId], fromUser: false, files: group.readyFiles) {
                                try await session.transferGroup($0)
                            }
                        }
                    }
                }
                SummaryCard("Triggers") {
                    if triggers.isEmpty {
                        Text("Ask here to schedule recurring work.").foregroundStyle(Theme.body)
                    } else {
                        ForEach(triggers) { trigger in
                            Button { showTriggers = true } label: {
                                summaryRow(trigger.name, subtitle: trigger.enabled ? trigger.schedule : "Paused", icon: "clock")
                            }.buttonStyle(.plain).disabled(!session.canManage)
                        }
                    }
                }
                if !loading && questions?.loaded == false {
                    Group {
                        Button("Couldn't load questions. Retry") { Task { await refresh() } }
                    }
                }
                if triggersFailed {
                    Group {
                        Button("Couldn't load schedules. Retry") { Task { await refresh() } }
                    }
                }
                if loading {
                    Group { ProgressView().frame(maxWidth: .infinity) }
                } else if !isBotDetails && !hasContent && questions?.loaded == true && !triggersFailed {
                    Group {
                        ContentUnavailableView {
                            Label { Text("Nothing here yet") } icon: { LucideIcon("layers", size: 32) }
                        } description: {
                            Text("Questions, changes, sub-tasks and files from this task appear here as work progresses.")
                        }
                    }
                }
              }.padding(Theme.Space.large)
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                if sizeClass == .regular {
                    HStack {
                        Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.heading)
                        Spacer()
                        Button(action: close) { LucideIcon("x").frame(width: 44, height: 44) }
                            .accessibilityLabel("Close summary")
                    }.padding(.leading, 16).padding(.trailing, 4).background(Theme.canvas)
                }
            }
            .background(Theme.canvas)
            .font(Theme.Text.secondary)
            .foregroundStyle(Theme.body)
            .tint(Theme.heading)
            .accessibilityIdentifier("agent-summary-list")
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .toolbar {
                if sizeClass != .regular {
                    if isBotDetails {
                        ToolbarItem(placement: .confirmationAction) { Button("Done", action: close) }
                    } else {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button(action: close) { LucideIcon("x") }.accessibilityLabel("Close summary")
                        }
                    }
                }
            }
            .refreshable { await refresh() }
            .task {
                questions = OpenQuestions(token: store.token, teamId: session.teamId)
                while !Task.isCancelled {
                    await refresh()
                    do { try await Task.sleep(for: .seconds(20)) } catch { return }
                }
            }
            .sheet(item: $selectedQuestion) { question in
                NavigationStack {
                    ScrollView {
                        if let questions {
                        BotQuestionCard(question: question, showsFrom: question.sessionId != session.sessionId,
                            onOpen: { selectedQuestion = nil; openQuestion(question) },
                            teamId: session.teamId, questions: questions,
                            onAnswer: { answer in Task { await questions.answer(question, with: answer) } },
                            onDismiss: { Task { await questions.dismiss(question) } })
                            .padding()
                        }
                    }
                    .navigationTitle("Question")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar(.visible, for: .navigationBar)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button { selectedQuestion = nil } label: { LucideIcon("x") }
                                .accessibilityLabel("Close question")
                        }
                    }
                }
            }
            .sheet(isPresented: $showTriggers) {
                ConversationTriggers(teamId: session.teamId, sessionId: session.sessionId, token: store.token)
            }
        }
    }

    private func summaryRow(_ title: String, subtitle: String, icon: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            LucideIcon(icon, size: 14).foregroundStyle(Theme.body).padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(.subheadline, weight: .medium)).foregroundStyle(Theme.heading).lineLimit(2)
                if !subtitle.isEmpty { Text(subtitle).font(.caption).foregroundStyle(Theme.body).lineLimit(2) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .multilineTextAlignment(.leading)
        .padding(.vertical, 3)
    }

    private func state(_ task: AgentConversation) -> String {
        let state = store.indicator(for: task, team: session.teamId)
        return state == .waiting ? String(localized: "Needs your input") : state.isRunning ? String(localized: "Running") : String(localized: "Idle")
    }

    private func openQuestion(_ question: BotQuestion) {
        if let child = children.first(where: { $0.sessionId == question.sessionId }) { openSession(child) }
        else { close() }
    }

    private func refresh() async {
        await questions?.refresh()
        guard !Task.isCancelled else { return }
        await session.refreshResources()
        await session.refreshDownloads()
        do {
            let result: [ConversationTrigger] = try await WorkspaceAPI.request("agent/triggers", query: [
                URLQueryItem(name: "teamId", value: session.teamId),
                URLQueryItem(name: "targetSessionId", value: session.sessionId),
            ], token: store.token)
            guard !Task.isCancelled else { return }
            triggers = result
            triggersFailed = false
        } catch {
            guard !Task.isCancelled else { return }
            triggersFailed = true
        }
        loading = false
    }
}

private struct SummaryCard<Content: View>: View {
    let title: LocalizedStringKey
    @ViewBuilder var content: Content
    init(_ title: LocalizedStringKey, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.medium) {
            Text(title).font(.system(.subheadline, weight: .semibold)).foregroundStyle(Theme.heading)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Theme.Space.large)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.card))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.card).stroke(Theme.hairline, lineWidth: 1))
    }
}

private struct SummaryBackgroundWork: Identifiable {
    let id: String
    let title: String
    let output: String

    static func items(_ snapshot: JSONValue?) -> [Self] {
        let terminals = (snapshot?["tools"]?.arrayValue ?? []).compactMap { tool -> Self? in
            guard let terminal = tool["terminal"], terminal["status"]?.stringValue == "running",
                  let id = tool["id"]?.stringValue else { return nil }
            return Self(id: id, title: terminal["command"]?.stringValue ?? "Command",
                        output: terminal["output"]?.stringValue ?? "")
        }
        let listed = Set(terminals.map(\.id))
        let tasks = (snapshot?["asyncTasks"]?.objectValue ?? [:]).sorted { $0.key < $1.key }.compactMap { key, task -> Self? in
            let state = task["state"]?.stringValue ?? ""
            guard !["completed", "failed", "cancelled", "stopped"].contains(state),
                  !listed.contains(task["toolCallId"]?.stringValue ?? "") else { return nil }
            return Self(id: task["id"]?.stringValue ?? key, title: task["name"]?.stringValue ?? key, output: "")
        }
        return terminals + tasks
    }
}


extension View {
    func agentSummary<Panel: View>(isPresented: Binding<Bool>, @ViewBuilder panel: @escaping () -> Panel) -> some View {
        modifier(AgentSummaryPresentation(isPresented: isPresented, panel: panel))
    }
}

private struct AgentSummaryPresentation<Panel: View>: ViewModifier {
    @Binding var isPresented: Bool
    let panel: () -> Panel
    @Environment(\.horizontalSizeClass) private var sizeClass

    func body(content: Content) -> some View {
        if sizeClass == .regular {
            content.inspector(isPresented: $isPresented) {
                panel().inspectorColumnWidth(min: 300, ideal: 340, max: 420)
            }
        } else {
            content.sheet(isPresented: $isPresented) {
                panel().presentationDetents([.large]).presentationDragIndicator(.visible)
            }
        }
    }
}

extension ConversationIndicator {
    var isRunning: Bool { self == .turn || self == .background }
    /// Waiting for you, then running, then the rest.
    fileprivate var rank: Int { self == .waiting ? 0 : isRunning ? 1 : 2 }
}

extension AgentStore {
    /// The Tasks a conversation dispatched: waiting for you first, then running,
    /// then the rest, newest first within each.
    func tasks(under parent: String, team: String) -> [AgentConversation] {
        conversations.filter { $0.parentSessionId == parent }.sorted {
            (indicator(for: $0, team: team).rank, $1.lastActiveAt) < (indicator(for: $1, team: team).rank, $0.lastActiveAt)
        }
    }

    /// What those Tasks are doing, as a Bot's page says it under the Bot's name:
    /// "1 needs input · 2 running", or nil when none waits or runs.
    func stateLine(under parent: String, team: String) -> (text: String, waiting: Bool)? {
        let states = tasks(under: parent, team: team).map { indicator(for: $0, team: team) }
        let waiting = states.filter { $0 == .waiting }.count
        let running = states.filter(\.isRunning).count
        var parts: [String] = []
        if waiting > 0 { parts.append(String(localized: "\(waiting) needs input")) }
        if running > 0 { parts.append(String(localized: "\(running) running")) }
        return parts.isEmpty ? nil : (parts.joined(separator: " · "), waiting > 0)
    }
}
