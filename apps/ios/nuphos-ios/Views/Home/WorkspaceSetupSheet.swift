import SwiftUI

/// First-use setup remains available from the agent picker for existing teams.
struct WorkspaceSetupSheet: View {
    @Environment(AuthSession.self) private var auth
    @Environment(AgentStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var name = "My workspace"
    @State private var discoverable: [Team] = []
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Create a workspace for your agents and runtimes, or join one your organization has made available.")
                    TextField("Workspace name", text: $name)
                    Button("Create workspace") { create() }
                        .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || name.count > 80)
                }
                if !discoverable.isEmpty {
                    Section("Available workspaces") {
                        ForEach(discoverable) { team in
                            Button("Join \(team.name)") { join(team) }
                        }
                    }
                }
                Section {
                    Text("Already invited? Accept the invitation from your email, then refresh your workspaces.")
                    Button("Refresh workspaces") { Task { await store.loadTeams(); if store.selectedTeam != nil { dismiss() } } }
                }
                if let error { Text(error).foregroundStyle(.red) }
                if busy { ProgressView() }
            }
            .disabled(busy)
            .navigationTitle("Set up workspace")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(busy) } }
            .task {
                guard let token = auth.token else { return }
                do {
                    let result: WorkspaceAPI.TeamsEnvelope = try await WorkspaceAPI.request("teams/discoverable", token: token)
                    discoverable = result.teams
                } catch { self.error = error.localizedDescription }
            }
        }
    }

    private func create() { enter(path: "teams", body: .object(["name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines))])) }
    private func join(_ team: Team) { enter(path: "teams/discoverable/\(team.id)/join", body: nil) }
    private func enter(path: String, body: JSONValue?) {
        guard let token = auth.token else { return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                let result: WorkspaceAPI.TeamEnvelope = try await WorkspaceAPI.request(path, token: token, method: "POST", body: body)
                await store.loadTeams()
                store.select(team: result.team)
                dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}
