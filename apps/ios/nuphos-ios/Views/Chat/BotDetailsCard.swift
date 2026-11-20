import SwiftUI

/// The card that leads a Bot's details, as Desktop's Bot details panel has it
/// (#2983): its face, name, runtime and model, and the way into the Bot's own Task.
/// Whoever manages the Bot switches its runtime and model here too.
struct BotDetailsCard: View {
    let channel: ChannelSession
    /// The Bot's own session, whose runtime and model the card shows and switches.
    let bot: ChatSession
    /// Nil when the viewer cannot open the Bot's own Task.
    let openTask: (() -> Void)?
    @Environment(AgentStore.self) private var store
    @State private var showRuntimes = false
    @State private var showModel = false
    @State private var switchError: String?

    private var runtime: String? {
        guard let bot = store.bots.first(where: { $0.sessionId == channel.botId }) else { return nil }
        return RuntimeInstance.Provider.detail(bot.agentRuntime, instance: bot.runtimeLabel)
    }

    var body: some View {
        VStack(spacing: 8) {
            ChatIcon(faces: channel.faces, title: channel.title, size: 64)
            Text(channel.title).font(.system(.headline, weight: .semibold)).foregroundStyle(Theme.heading).lineLimit(2)
            if let runtime { Text(runtime).font(.caption).foregroundStyle(Theme.muted) }
            if let model = bot.sessionConfig?.model?.currentLabel {
                Text(model).font(.caption).foregroundStyle(Theme.muted).accessibilityIdentifier("bot-model")
            }
            if bot.canManage {
                HStack(spacing: 8) {
                    Button { showRuntimes = true } label: {
                        Label { Text("Switch runtime") } icon: { LucideIcon("arrow-left-right", size: 14) }
                    }
                    .disabled(bot.isStreaming)
                    .accessibilityIdentifier("bot-switch-runtime")
                    if bot.isNativeRuntime, bot.sessionConfig?.status != .unsupported {
                        Button { showModel = true } label: {
                            Label { Text("Model") } icon: { LucideIcon("cpu", size: 14) }
                        }
                        .accessibilityIdentifier("bot-model-settings")
                    }
                }
                .buttonStyle(.bordered)
            }
            if let openTask {
                Button(action: openTask) {
                    Label { Text("Task") } icon: { LucideIcon("clipboard-list", size: 14) }
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("bot-task-entry")
            }
        }
        .frame(maxWidth: .infinity)
        .padding(Theme.Space.large)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.card))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.card).stroke(Theme.hairline, lineWidth: 1))
        .sheet(isPresented: $showRuntimes) {
            RuntimePickerSheet(session: bot) { runtime in
                Task {
                    do { try await bot.move(to: runtime); showRuntimes = false; await store.reload() }
                    catch { switchError = error.localizedDescription }
                }
            }
        }
        .sheet(isPresented: $showModel) { ModelSettingsSheet(session: bot).presentationDetents([.medium, .large]) }
        .alert("Couldn't switch runtime", isPresented: Binding(get: { switchError != nil }, set: { if !$0 { switchError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(switchError ?? "") }
    }
}

/// A Task a Bot dispatched, as its details list it: what it is doing at a glance.
struct BotTaskRow: View {
    let task: AgentConversation
    let state: ConversationIndicator

    var body: some View {
        HStack(spacing: 12) {
            RuntimeMark(runtime: task.agentRuntime, size: 22).frame(width: 22, height: 22)
            VStack(alignment: .leading, spacing: 3) {
                Text(task.displayTitle).font(.system(.subheadline, weight: .medium)).foregroundStyle(Theme.heading).lineLimit(1)
                Text(label).font(.caption).foregroundStyle(state == .waiting ? Theme.attention : Theme.muted).lineLimit(1)
            }
            Spacer(minLength: 0)
            if state == .waiting {
                Circle().fill(Theme.attention).frame(width: 7, height: 7)
            } else if state.isRunning {
                ProgressView().controlSize(.small).tint(Theme.muted)
            }
            LucideIcon("chevron-right", size: 14).foregroundStyle(Theme.muted)
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }

    private var label: String {
        if state == .waiting { return String(localized: "Needs your input") }
        if state.isRunning { return String(localized: "Running") }
        return String(localized: "Idle · \(HistoryTime.format(task.lastActiveAt))")
    }
}
