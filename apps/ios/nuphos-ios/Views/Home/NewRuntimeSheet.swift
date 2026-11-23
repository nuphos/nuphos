import SwiftUI

/// A new runtime on a computer, in one sheet: the provider, its settings, then its
/// sign-in — Desktop's + menu and BoxAgentSetup, as a list and a form. A provider the
/// computer already has signed out is signed in instead of doubled, and leaving a new
/// runtime's sign-in removes it again: it exists only once signed in.
struct NewRuntimeSheet: View {
    @Environment(AuthSession.self) private var auth
    @Environment(AgentStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let team: Team
    let device: AgentDevice
    /// The runtimes this computer already has: what to sign in, and the default name.
    let existing: [RuntimeInstance]

    /// What the backend answers with: the runtime is pending until it signs in.
    struct Created: Decodable, Equatable {
        let instanceId: String
        let runtimeId: String
        let label: String
    }

    @State private var provider: RuntimeInstance.Provider?
    /// A runtime the computer already has, signed in here instead of adding another.
    @State private var signingIn: RuntimeInstance?
    @State private var name = ""
    @State private var created: Created?
    @State private var busy = false
    @State private var error: String?

    private var path: String { "agent/devices/\(device.deviceId)/agents" }
    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var box: SelectorBox { .init(id: device.deviceId, label: device.label, device: device, agents: existing) }

    var body: some View {
        NavigationStack {
            if let created, let provider {
                signIn(pending(created, provider)) { leave(created) }
            } else if let signingIn {
                signIn(signingIn) { dismiss() }
            } else if let provider {
                settings(provider)
            } else {
                providers
            }
        }
        .interactiveDismissDisabled(busy || created != nil)
    }

    // MARK: - Provider

    private var providers: some View {
        List {
            Section {
                ForEach(NewRuntime.providers, id: \.rawValue) { candidate in
                    let action = NewRuntime.action(existing, candidate)

                    Button { choose(candidate, action) } label: { row(candidate, action) }
                        .buttonStyle(.plain)
                        .disabled(action == .unavailable)
                        .accessibilityIdentifier("provider-\(candidate.rawValue)")
                }
            } header: {
                Text(device.label)
            }
        }
        .navigationTitle("New runtime")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
    }

    private func row(_ candidate: RuntimeInstance.Provider, _ action: NewRuntime.Action) -> some View {
        HStack(spacing: 12) {
            ProviderIcon(provider: candidate, size: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(title(candidate, action)).font(.system(size: 15)).foregroundStyle(Theme.heading)
                if action == .unavailable {
                    Text("Antigravity uses this computer’s shared sign-in")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }

    /// What the row offers: signing in the one this computer has, else adding one.
    private func title(_ candidate: RuntimeInstance.Provider, _ action: NewRuntime.Action) -> String {
        let label = RuntimeInstance.Provider.name(candidate.rawValue)

        if case .signIn = action { return String(localized: "Sign in to \(label)") }

        return NewRuntime.previews.contains(candidate) ? String(localized: "\(label) · Preview") : label
    }

    private func choose(_ candidate: RuntimeInstance.Provider, _ action: NewRuntime.Action) {
        switch action {
        case .create:
            name = box.defaultRuntimeName(candidate)
            provider = candidate
        case .signIn(let runtimeId):
            signingIn = existing.first { $0.id == runtimeId }
        case .unavailable:
            break
        }
    }

    // MARK: - Settings

    private func settings(_ candidate: RuntimeInstance.Provider) -> some View {
        let label = RuntimeInstance.Provider.name(candidate.rawValue)

        return Form {
            Section {
                HStack(spacing: 10) {
                    ProviderIcon(provider: candidate, size: 30)
                    Text(label).font(.system(size: 15)).foregroundStyle(Theme.heading)
                }
            } footer: {
                Text("On \(device.label). You sign it in next.")
            }
            Section {
                TextField("Runtime name", text: $name)
                    .autocorrectionDisabled()
                    .submitLabel(.continue)
                    .onSubmit { create(candidate) }
            } header: {
                Text("Name")
            } footer: {
                Text(box.nameTaken(name)
                    ? "Another runtime on this computer already has this name."
                    : "How this runtime appears on the computer and when choosing a runtime for a Bot or task.")
            }
            if let error {
                Section { Label(error, image: "lucide-triangle-alert").foregroundStyle(.red).font(.footnote) }
            }
        }
        .navigationTitle("New runtime")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                if busy {
                    ProgressView()
                } else {
                    Button("Continue") { create(candidate) }.glassProminentButton().disabled(trimmed.isEmpty)
                }
            }
        }
    }

    // MARK: - Sign in

    private func signIn(_ runtime: RuntimeInstance, onCancel: @escaping () -> Void) -> some View {
        AgentSetupView(team: team, runtime: runtime, selectOnCompletion: false)
            .environment(store)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) } }
    }

    /// The runtime just made, as the sign-in knows one; its computer names it, as Desktop does.
    private func pending(_ created: Created, _ candidate: RuntimeInstance.Provider) -> RuntimeInstance {
        .init(
            id: created.runtimeId, provider: candidate,
            label: String(localized: "\(created.label) on \(device.label)"),
            status: .active, kind: "local",
            local: .init(ownerUserId: "", deviceId: device.deviceId, deviceLabel: device.label, signedIn: false))
    }

    // MARK: - Actions

    private func create(_ candidate: RuntimeInstance.Provider) {
        guard let token = auth.token, !trimmed.isEmpty, !busy else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            var body: [String: JSONValue] = ["teamId": .string(team.id), "provider": .string(candidate.rawValue)]
            // The provider's own name is the default a runtime has without one.
            if trimmed != RuntimeInstance.Provider.name(candidate.rawValue) { body["label"] = .string(trimmed) }
            do {
                created = try await WorkspaceAPI.request(path, token: token, method: "POST", body: .object(body))
            } catch { self.error = error.localizedDescription }
        }
    }

    /// Leaving a new runtime's sign-in removes it again.
    private func leave(_ created: Created) {
        if let token = auth.token {
            Task {
                _ = try? await AgentChatAPI.send(
                    "DELETE", "\(path)/\(created.instanceId)",
                    query: [URLQueryItem(name: "teamId", value: team.id)], token: token, body: JSONValue?.none)
                await store.loadRuntimes()
            }
        }
        dismiss()
    }
}
