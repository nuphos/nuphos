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

    var schedule: String { scheduleDescription ?? (triggerType == "cron" ? "Schedule: \(cronExpression ?? "") (UTC)" : "When a webhook arrives") }
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
                    Text("Ask the agent to schedule recurring work in this conversation.").foregroundStyle(.secondary)
                }
                ForEach(triggers) { trigger in
                    Toggle(isOn: Binding(get: { trigger.enabled }, set: { enabled in
                        Task { await toggle(trigger, enabled: enabled) }
                    })) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(trigger.name)
                            Text(trigger.schedule).font(.caption).foregroundStyle(.secondary)
                            if !trigger.enabled { Text("Paused").font(.caption).foregroundStyle(.secondary) }
                            else if let date = trigger.nextRun {
                                Text("Next: \(date.formatted(date: .abbreviated, time: .shortened))").font(.caption).foregroundStyle(.secondary)
                            } else {
                                Text(trigger.triggerType == "webhook" ? "Waiting for webhook" : "No upcoming runs").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .disabled(trigger.canManage != true || pending.contains(trigger.id))
                    .accessibilityLabel("Enable \(trigger.name)")
                }
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
