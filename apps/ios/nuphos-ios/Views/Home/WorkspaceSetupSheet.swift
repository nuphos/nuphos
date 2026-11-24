import SwiftUI

/// First-use setup remains available from the agent picker for existing teams.
struct WorkspaceSetupSheet: View {
    @Environment(AuthSession.self) private var auth
    @Environment(AgentStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    // Stored as the workspace name, so it stays English like Desktop's default.
    var onComplete: ((Team) -> Void)? = nil
    var onDraft: ((String) -> Void)? = nil
    var draftName: String? = nil
    @State private var name = "My team"
    @State private var checkedDiscoverable = false
    @State private var discoverable: [Team] = []
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        if onComplete != nil {
            content
        } else {
            NavigationStack {
                content.toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button { dismiss() } label: { LucideIcon("x") }
                            .accessibilityLabel("Close").disabled(busy)
                    }
                }
            }
        }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if onDraft != nil && !store.teams.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Your workspaces").font(.headline)
                        ForEach(store.teams) { team in
                            Button {
                                store.select(team: team)
                                complete(team)
                            } label: {
                                HStack(spacing: 12) {
                                    TeamAvatar(team: team, size: 36)
                                    Text(team.name).font(.body)
                                    Spacer()
                                    Image(systemName: "chevron.right").accessibilityHidden(true)
                                }
                                .padding(12)
                                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.card))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                    Text("Create a team for your Bots and runtimes, or join one your organization has made available.")
                    .font(.callout).foregroundStyle(Theme.body)
                VStack(alignment: .leading, spacing: 12) {
                    Text("Team name").font(.footnote.weight(.medium)).foregroundStyle(Theme.body)
                    TextField("Team name", text: $name)
                        .font(.callout).padding(14).background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                    Button {
                        if let onDraft { onDraft(name.trimmingCharacters(in: .whitespacesAndNewlines)) }
                        else { create() }
                    } label: {
                        Text(onDraft == nil ? "Create team" : "Continue with new workspace")
                            .frame(maxWidth: .infinity)
                    }
                        .prominentButton()
                        .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || name.count > 80)
                }
                if !discoverable.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Available teams").font(.footnote.weight(.medium)).foregroundStyle(Theme.muted)
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
                if onDraft != nil, checkedDiscoverable, discoverable.isEmpty {
                    Text("No other workspaces are available to join.")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Already invited? Accept the invitation from your email, then refresh your teams.").font(.footnote).foregroundStyle(Theme.body)
                    Button("Refresh teams") {
                        Task {
                            await store.loadTeams()
                            if onDraft == nil, let team = store.selectedTeam { complete(team) }
                            await loadDiscoverable()
                        }
                    }
                        .font(.callout.weight(.medium)).foregroundStyle(Theme.link).frame(minHeight: 44)
                }
                if let error { Text(error).font(.footnote).foregroundStyle(Theme.attention) }
                if busy { ProgressView() }
            }.padding(24).frame(maxWidth: 560).frame(maxWidth: .infinity)
        }
        .background(Theme.canvas)
        .disabled(busy)
        .navigationTitle("Set up a team")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if let draftName { name = draftName }
            await loadDiscoverable()
        }
    }

    private func loadDiscoverable() async {
        guard let token = auth.token else { return }
        do {
            let result: WorkspaceAPI.TeamsEnvelope = try await WorkspaceAPI.request("teams/discoverable", token: token)
            try Task.checkCancellation()
            discoverable = result.teams
            checkedDiscoverable = true
            error = nil
        } catch {
            guard !Task.isCancelled, (error as? URLError)?.code != .cancelled else { return }
            checkedDiscoverable = false
            self.error = error.localizedDescription
        }
    }

    private func complete(_ team: Team) {
        if let onComplete { onComplete(team) } else { dismiss() }
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
                complete(result.team)
            } catch { self.error = error.localizedDescription }
        }
    }
}
