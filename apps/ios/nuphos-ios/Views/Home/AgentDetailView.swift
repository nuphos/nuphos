import SwiftUI

/// One Cloud agent's own page, like Desktop's Settings → Agent: rename it,
/// see its usage, sign it in again, disable or remove it.
struct AgentDetailView: View {
    @Environment(AuthSession.self) private var auth
    @Environment(AgentStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let team: Team
    let runtime: RuntimeInstance
    @State private var name: String
    @State private var busy = false
    @State private var confirmRemoval = false
    @State private var error: String?

    init(team: Team, runtime: RuntimeInstance) {
        self.team = team
        self.runtime = runtime
        _name = State(initialValue: runtime.label)
    }

    /// The list's copy, so a rename or a disable shows as soon as it lands.
    private var current: RuntimeInstance { store.runtimes.first { $0.id == runtime.id } ?? runtime }
    private var quota: RuntimeQuota? { store.quotas[runtime.id] }
    private var path: String { "teams/\(team.id)/agent-runtimes/\(runtime.id)" }

    var body: some View {
        Form {
            Section("Name") {
                TextField("Agent name", text: $name)
                    .submitLabel(.done)
                    .onSubmit {
                        let label = name.trimmingCharacters(in: .whitespacesAndNewlines)
                        if !label.isEmpty, label != current.label { update(["label": .string(label)]) }
                    }
            }
            Section("Usage") {
                if let quota, quota.available {
                    ForEach(quota.windows, id: \.label) { window in
                        LabeledContent(window.label, value: "\(Int(window.usedPercent.rounded()))% used")
                    }
                } else {
                    Text(quota?.reason ?? "Unavailable").foregroundStyle(.secondary)
                }
            }
            Section {
                if current.status == .active {
                    NavigationLink(quota?.needsSignIn == true ? "Sign In" : "Sign In Again") {
                        AgentSetupView(team: team, runtime: current)
                    }
                }
                Toggle("Enabled", isOn: Binding(
                    get: { current.status == .active },
                    set: { update(["status": .string($0 ? "active" : "disabled")]) }
                ))
            }
            Section {
                Button("Remove Agent", role: .destructive) { confirmRemoval = true }
            }
            if let error {
                Section { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).font(.footnote) }
            }
        }
        .disabled(busy)
        .navigationTitle(current.label)
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Remove \(current.label)?", isPresented: $confirmRemoval, titleVisibility: .visible) {
            Button("Remove Agent", role: .destructive) { remove() }
        } message: {
            Text(current.kind == "managed"
                ? "Nuphos permanently deletes this agent and its disk, including its sign-in. Your conversation history stays in Nuphos."
                : "This disconnects the agent. Your conversations stay in Nuphos.")
        }
    }

    private func update(_ patch: [String: JSONValue]) {
        guard let token = auth.token else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                let _: RuntimeInstance = try await WorkspaceAPI.request(path, token: token, method: "PATCH", body: .object(patch))
                await store.loadRuntimes(force: true)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func remove() {
        guard let token = auth.token else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                _ = try await AgentChatAPI.send("DELETE", path, token: token, body: nil as JSONValue?)
                await store.loadRuntimes(force: true)
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
