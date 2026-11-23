import SwiftUI

struct ConversationTrigger: Decodable, Identifiable {
    let id: String
    let name: String
    let enabled: Bool
    let triggerType: String
    let scheduleDescription: String?
    let cronExpression: String?
    let nextRunAt: String?
    let canManage: Bool?
    let messageTemplate: String?

    var schedule: String { scheduleDescription ?? (triggerType == "cron" ? String(localized: "Schedule: \(cronExpression ?? "") (UTC)") : String(localized: "When a webhook arrives")) }
    var nextRun: Date? {
        guard let nextRunAt else { return nil }
        let format = ISO8601DateFormatter()
        format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return format.date(from: nextRunAt) ?? ISO8601DateFormatter().date(from: nextRunAt)
    }
}

struct ConversationTriggers: View {
    let teamId: String
    let sessionId: String
    let token: String
    /// Starts a message asking the agent to change a Trigger; without one, the details say to ask in the conversation.
    var onEdit: ((String) -> Void)? = nil
    @State private var opened: String?
    @State private var triggers: [ConversationTrigger] = []
    @State private var loading = true
    @State private var pending: Set<String> = []
    @State private var failure: String?
    @State private var revision = 0
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let failure { Text(failure).foregroundStyle(.red).accessibilityAddTraits(.updatesFrequently) }
                if loading { ProgressView() }
                if !loading && triggers.isEmpty && failure == nil {
                    Text("Ask the agent to schedule recurring work in this conversation.").foregroundStyle(Theme.body)
                }
                ForEach(triggers) { trigger in
                    // The row opens what the Trigger sends; the switch beside it stays a separate control.
                    HStack(alignment: .top) {
                        Button { opened = trigger.id } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(trigger.name).foregroundStyle(Theme.heading)
                                Text(trigger.schedule).font(.caption).foregroundStyle(Theme.body)
                                Text(nextRunLabel(trigger)).font(.caption).foregroundStyle(Theme.body)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("trigger-row-\(trigger.id)")
                        Toggle(isOn: Binding(get: { trigger.enabled }, set: { enabled in
                            Task { await toggle(trigger, enabled: enabled) }
                        })) { EmptyView() }
                        .labelsHidden()
                        .disabled(trigger.canManage != true || pending.contains(trigger.id))
                        .accessibilityLabel("Enable \(trigger.name)")
                    }
                }
            }
            .navigationDestination(item: $opened) { id in
                if let trigger = triggers.first(where: { $0.id == id }) { details(trigger) }
            }
            .navigationTitle("Triggers")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .refreshable { await reload() }
            .task {
                while !Task.isCancelled {
                    await reload()
                    do { try await Task.sleep(for: .seconds(30)) } catch { return }
                }
            }
        }
    }

    private func nextRunLabel(_ trigger: ConversationTrigger) -> String {
        if !trigger.enabled { return String(localized: "Paused") }
        if let date = trigger.nextRun { return String(localized: "Next: \(date.formatted(date: .abbreviated, time: .shortened))") }
        return trigger.triggerType == "webhook" ? String(localized: "Waiting for webhook") : String(localized: "No upcoming runs")
    }

    private func details(_ trigger: ConversationTrigger) -> some View {
        List {
            Section {
                Text(trigger.messageTemplate ?? "").foregroundStyle(Theme.body).textSelection(.enabled)
                    .accessibilityIdentifier("trigger-instruction")
            }
            Section {
                Text(trigger.schedule)
                Text(nextRunLabel(trigger)).foregroundStyle(Theme.body)
            }
            Section {
                if let onEdit {
                    Button("Edit") {
                        onEdit(String(localized: "Edit your trigger “\(trigger.name)”: "))
                        dismiss()
                    }
                    .accessibilityIdentifier("trigger-edit")
                } else {
                    Text("Ask here to change this trigger.").foregroundStyle(Theme.body)
                }
            }
        }
        .navigationTitle(trigger.name)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func reload() async {
        let requested = revision
        do {
            let rows: [ConversationTrigger] = try await WorkspaceAPI.request(
                "agent/triggers", query: [URLQueryItem(name: "teamId", value: teamId), URLQueryItem(name: "targetSessionId", value: sessionId)], token: token)
            if Task.isCancelled || requested != revision { return }
            triggers = rows
            failure = nil
        } catch { if !Task.isCancelled { failure = error.localizedDescription } }
        loading = false
    }

    private func toggle(_ trigger: ConversationTrigger, enabled: Bool) async {
        guard pending.insert(trigger.id).inserted else { return }
        defer { pending.remove(trigger.id) }
        do {
            let _: ConversationTrigger = try await WorkspaceAPI.request(
                "agent/triggers/\(trigger.id)", query: [URLQueryItem(name: "teamId", value: teamId)], token: token,
                method: "PATCH", body: .object(["enabled": .bool(enabled)]))
            revision += 1
            await reload()
        } catch { failure = error.localizedDescription }
    }
}
