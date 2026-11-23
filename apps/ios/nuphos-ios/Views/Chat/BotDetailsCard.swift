import SwiftUI

/// The card that leads a Bot's details, as Desktop's Bot details panel has it
/// (#2983): its face, name, runtime and model, and the way into the Bot's own Task.
struct BotDetailsCard: View {
    let channel: ChannelSession
    /// Nil when the viewer cannot open the Bot's own Task.
    let openTask: (() -> Void)?
    @Environment(AgentStore.self) private var store
    @State private var model: String?

    /// Runtime, model and computer, e.g. "Claude Code · Sonnet · Preview Box".
    private var runtime: String? {
        guard let bot = store.bots.first(where: { $0.sessionId == channel.botId }) else { return nil }
        let provider = RuntimeInstance.Provider.name(bot.agentRuntime)
        let instance = bot.runtimeLabel.flatMap { $0.isEmpty || $0 == provider ? nil : $0 }
        return [provider, model, instance].compactMap { $0 }.joined(separator: " · ")
    }

    var body: some View {
        VStack(spacing: 8) {
            ChatIcon(faces: channel.faces, title: channel.title, size: 64)
            Text(channel.title).font(.system(.headline, weight: .semibold)).foregroundStyle(Theme.heading).lineLimit(2)
            if let runtime { Text(runtime).font(.caption).foregroundStyle(Theme.muted) }
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
        .task(id: channel.botId) { if let id = channel.botId { model = await store.botModel(id) } }
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.card))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.card).stroke(Theme.hairline, lineWidth: 1))
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

    var body: some View {
        if let bot = store.bots.first(where: { $0.sessionId == botId }), bot.ownsChat {
            let instructions = bot.instructions ?? ""
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
                        .accessibilityIdentifier("bot-instructions-field")
                    if let error {
                        Text(error).font(.caption).foregroundStyle(Theme.attention).accessibilityIdentifier("bot-instructions-error")
                    }
                    HStack {
                        Spacer()
                        Button("Cancel") { draft = nil; error = nil }.buttonStyle(.bordered)
                        Button { Task { await save(text) } } label: {
                            HStack(spacing: 6) {
                                if saving { ProgressView().controlSize(.small) }
                                Text("Save")
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(text == instructions || saving)
                        .accessibilityIdentifier("bot-instructions-save")
                    }
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
