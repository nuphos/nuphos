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
        SummaryCard("Runtime") {
            if bot.ownsChat {
                NavigationLink {
                    RuntimePicker(session: bot, onMove: onMove, detent: .constant(.large), pushed: true)
                } label: { row("Runtime", bot.runtimeName(in: store), opens: true) { runtimeMark } }
                .accessibilityIdentifier("bot-details-runtime")
            } else {
                row("Runtime", bot.runtimeName(in: store), opens: false) { runtimeMark }
                    .accessibilityIdentifier("bot-details-runtime")
            }
            NavigationLink {
                ModelSettingsSheet(session: bot, pushed: true)
            } label: { row("Model", bot.modelTitle, opens: true) { LucideIcon("cpu", size: 14).foregroundStyle(Theme.body) } }
            .accessibilityIdentifier("bot-details-model")
        }
        .buttonStyle(.plain)
        // Again once the Bot's own read settles: a model read that failed with it gets another try.
        .task(id: bot.loaded) {
            await store.loadRuntimes()
            await bot.refreshSessionConfig()
        }
    }

    /// The runtime's own mark, as Desktop and the Task list point to a runtime.
    private var runtimeMark: some View {
        RuntimeMark(runtime: (bot.runtime ?? store.runtimes.first { $0.id == bot.runtimeId })?.provider.rawValue ?? bot.agentRuntime, size: 14).frame(width: 14, height: 14)
    }

    private func row(_ title: LocalizedStringKey, _ value: String, opens: Bool, @ViewBuilder icon: () -> some View) -> some View {
        HStack(spacing: 12) {
            icon()
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

/// A Bot's standing instructions in full, as Desktop's Bot details has them (#4084). Only the
/// owner sees them here, and rewrites them in place; the server's refusal shows under the field.
struct BotInstructionsCard: View {
    let botId: String
    @Environment(AgentStore.self) private var store
    @State private var draft: String?
    @State private var saving = false
    @State private var error: String?
    @FocusState private var editing: Bool

    var body: some View {
        if let bot = store.bots.first(where: { $0.sessionId == botId }), bot.ownsChat {
            let instructions = bot.instructions ?? ""
            ScrollViewReader { proxy in
            VStack(alignment: .leading, spacing: Theme.Space.medium) {
                HStack {
                    Text("Bot instructions").font(.system(.subheadline, weight: .semibold)).foregroundStyle(Theme.heading)
                    Spacer()
                    if draft == nil {
                        Button { draft = instructions } label: { LucideIcon("pencil", size: 14) }
                            .accessibilityLabel(Text("Edit instructions"))
                            .accessibilityIdentifier("bot-instructions-edit")
                    }
                }
                if let text = draft {
                    TextEditor(text: Binding { text } set: { draft = $0 })
                        .frame(minHeight: 120, maxHeight: 320)
                        .scrollContentBackground(.hidden)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.hairline, lineWidth: 1))
                        .accessibilityLabel(Text("Bot instructions"))
                        .focused($editing)
                        .accessibilityIdentifier("bot-instructions-field")
                    if let error {
                        Text(error).font(.caption).foregroundStyle(Theme.attention).accessibilityIdentifier("bot-instructions-error")
                    }
                    HStack {
                        Spacer()
                        Button("Cancel") { draft = nil; error = nil }.buttonStyle(.borderless)
                        Button { Task { await save(text) } } label: {
                            HStack(spacing: 6) {
                                if saving { ProgressView().controlSize(.small) }
                                Text("Save")
                            }
                        }
                        .buttonStyle(DesignPrimaryButtonStyle(minimumHeight: 36))
                        .disabled(text == instructions || saving)
                        .accessibilityIdentifier("bot-instructions-save")
                    }
                    .id("bot-instructions-actions")
                } else if instructions.isEmpty {
                    Text("None yet").foregroundStyle(Theme.muted)
                } else {
                    Text(instructions).foregroundStyle(Theme.body).textSelection(.enabled)
                        .accessibilityIdentifier("bot-instructions-text")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Theme.Space.large)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.card))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.card).stroke(Theme.hairline, lineWidth: 1))
            // The keyboard covers the bottom of the sheet, so keep Cancel and Save above it when
            // editing starts and when a refusal pushes them down.
            .onChange(of: editing) { _, now in if now { showActions(proxy) } }
            .onChange(of: error) { _, now in if now != nil { showActions(proxy) } }
            }
        }
    }

    private func showActions(_ proxy: ScrollViewProxy) {
        Task {
            try? await Task.sleep(for: .milliseconds(400))
            withAnimation { proxy.scrollTo("bot-instructions-actions", anchor: .bottom) }
        }
    }

    private func save(_ text: String) async {
        saving = true
        error = nil
        defer { saving = false }
        do {
            try await store.setBotInstructions(botId, text)
            draft = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
