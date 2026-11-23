import SwiftUI

/// The card that leads a Bot's details, as Desktop's Bot details panel has it
/// (#2983): its face, name, and the way into the Bot's own Task.
struct BotDetailsCard: View {
    let channel: ChannelSession
    /// Nil when the viewer cannot open the Bot's own Task.
    let openTask: (() -> Void)?

    var body: some View {
        VStack(spacing: 8) {
            ChatIcon(faces: channel.faces, title: channel.title, size: 64)
            Text(channel.title).font(.system(.headline, weight: .semibold)).foregroundStyle(Theme.heading).lineLimit(2)
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
    }
}

/// A Bot's runtime and model, where they are picked: its owner pushes either
/// picker onto the details' stack; anyone else sees what it runs.
struct BotRuntimeCard: View {
    let bot: ChatSession
    var onMove: (RuntimeInstance) -> Void
    @Environment(AgentStore.self) private var store

    var body: some View {
        SummaryCard(String(localized: "Runtime")) {
            if bot.ownsChat {
                NavigationLink {
                    RuntimePicker(session: bot, onMove: onMove, detent: .constant(.large), pushed: true)
                } label: { row("Runtime", bot.runtimeName(in: store), icon: "monitor", opens: true) }
                .accessibilityIdentifier("bot-details-runtime")
            } else {
                row("Runtime", bot.runtimeName(in: store), icon: "monitor", opens: false)
                    .accessibilityIdentifier("bot-details-runtime")
            }
            NavigationLink {
                ModelSettingsSheet(session: bot, pushed: true)
            } label: { row("Model", bot.modelTitle, icon: "cpu", opens: true) }
            .accessibilityIdentifier("bot-details-model")
        }
        .buttonStyle(.plain)
        .task(id: bot.sessionId) {
            await store.loadRuntimes()
            await bot.refreshSessionConfig()
        }
    }

    private func row(_ title: LocalizedStringKey, _ value: String, icon: String, opens: Bool) -> some View {
        HStack(spacing: 12) {
            LucideIcon(icon, size: 14).foregroundStyle(Theme.body)
            Text(title).font(.system(.subheadline, weight: .medium)).foregroundStyle(Theme.heading)
            Spacer(minLength: 8)
            Text(value).font(.subheadline).foregroundStyle(Theme.muted).lineLimit(1)
            if opens { LucideIcon("chevron-right", size: 14).foregroundStyle(Theme.muted) }
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
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
