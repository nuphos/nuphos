import SwiftUI

/// First-use setup remains available from the agent picker for existing teams.
struct WorkspaceSetupSheet: View {
    @Environment(AuthSession.self) private var auth
    @Environment(AgentStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    // Stored as the workspace name, so it stays English like Desktop's default.
    @State private var name = "My workspace"
    @State private var discoverable: [Team] = []
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("Create a workspace for your agents and runtimes, or join one your organization has made available.")
                        .font(.callout).foregroundStyle(Theme.body)
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Workspace name").font(.footnote.weight(.medium)).foregroundStyle(Theme.body)
                        TextField("Workspace name", text: $name)
                            .font(.callout).padding(14).background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                        Button { create() } label: { Text("Create workspace").frame(maxWidth: .infinity) }
                            .prominentButton()
                            .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || name.count > 80)
                    }
                    if !discoverable.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Available workspaces").font(.footnote.weight(.medium)).foregroundStyle(Theme.muted)
                            VStack(spacing: 4) {
                                ForEach(discoverable) { team in
                                    Button { join(team) } label: {
                                        HStack(spacing: 12) {
                                            TeamAvatar(team: team)
                                            Text(team.name).font(.callout)
                                            Spacer()
                                            Text("Join").font(.footnote.weight(.medium))
                                        }.padding(12).foregroundStyle(Theme.heading).frame(minHeight: 48)
                                    }.buttonStyle(.plain)
                                }
                            }.background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
                        }
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Already invited? Accept the invitation from your email, then refresh your workspaces.").font(.footnote).foregroundStyle(Theme.body)
                        Button("Refresh workspaces") { Task { await store.loadTeams(); if store.selectedTeam != nil { dismiss() } } }
                            .font(.callout.weight(.medium)).foregroundStyle(Theme.link).frame(minHeight: 44)
                    }
                    if let error { Text(error).font(.footnote).foregroundStyle(Theme.attention) }
                    if busy { ProgressView() }
                }.padding(24).frame(maxWidth: 560).frame(maxWidth: .infinity)
            }
            .background(Theme.canvas)
            .disabled(busy)
            .navigationTitle("Set up workspace")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button { dismiss() } label: { LucideIcon("x") }.accessibilityLabel("Close").disabled(busy) } }
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
