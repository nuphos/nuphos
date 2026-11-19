import SwiftUI

struct TeamPickerView: View {
    let store: AgentStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            Section {
                ForEach(store.teams) { team in
                    Button {
                        store.select(team: team)
                        dismiss()
                    } label: {
                        HStack(spacing: 12) {
                            TeamSelectionLabel(team: team)
                            if store.selectedTeam?.id == team.id {
                                LucideIcon("check")
                                    .foregroundStyle(Theme.heading)
                                    .accessibilityLabel("Current team")
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(store.selectedTeam?.id == team.id ? .isSelected : [])
                }
            }
            .listRowBackground(Theme.surface)
        }
        .scrollContentBackground(.hidden)
        .background(Theme.canvas)
        .navigationTitle("Team")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct TeamSelectionLabel: View {
    let team: Team

    var body: some View {
        HStack(spacing: 12) {
            TeamAvatar(team: team, size: 28)
            Text(team.name)
                .font(.body.weight(.medium)).foregroundStyle(Theme.heading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: 36)
    }
}

/// Team identity is shown both in the toolbar and in the switcher.
struct TeamAvatar: View {
    let team: Team
    var size: CGFloat = 24

    var body: some View {
        AsyncImage(url: team.avatarUrl.flatMap(URL.init(string:))) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            ZStack {
                Theme.surface
                Text(String(team.name.prefix(2)).uppercased())
                    .font(.system(size: size * 0.4, weight: .semibold))
                    .foregroundStyle(Theme.body)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.25))
        .accessibilityHidden(true)
    }
}

/// Compact content for a native popover: no nested inset List or navigation bar.
struct TeamSwitcherPopover: View {
    let store: AgentStore
    @Environment(\.dismiss) private var dismiss
    @State private var showCreate = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(store.teams) { team in
                    Button {
                        store.select(team: team)
                        dismiss()
                    } label: {
                        HStack(spacing: 12) {
                            TeamSelectionLabel(team: team)
                            if store.selectedTeam?.id == team.id {
                                LucideIcon("check")
                            }
                        }
                        .padding(.horizontal, 8)
                        .frame(minHeight: 52)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("team-option-\(team.id)")
                    .accessibilityAddTraits(store.selectedTeam?.id == team.id ? .isSelected : [])
                    Divider().padding(.leading, 48)
                }
                Button { showCreate = true } label: {
                    HStack(spacing: 12) {
                        LucideIcon("plus").frame(width: 28, height: 28)
                        Text("Create team").font(.body.weight(.medium))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                        .frame(minHeight: 52)
                        .padding(.horizontal, 8)
                }
                .buttonStyle(.plain)
            }
            .padding(.vertical, 6)
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 12)
        .padding(.vertical, 20)
        .accessibilityIdentifier("team-switcher")
        .sheet(isPresented: $showCreate) {
            CreateTeamSheet(store: store) { dismiss() }
        }
    }
}

private struct CreateTeamSheet: View {
    let store: AgentStore
    let created: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var saving = false
    @State private var failure: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                TextField("Team name", text: $name).focused($focused)
                if let failure { Text(failure).foregroundStyle(.red) }
            }
            .navigationTitle("Create team")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task { await create() }
                    }.disabled(saving || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || name.count > 80)
                }
            }
            .interactiveDismissDisabled(saving)
            .task { focused = true }
        }
    }

    private func create() async {
        saving = true
        defer { saving = false }
        do {
            struct Response: Decodable { let team: Team }
            let result: Response = try await WorkspaceAPI.request("teams", token: store.token, method: "POST",
                body: .object(["name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines))]))
            await store.loadTeams()
            store.select(team: result.team)
            dismiss()
            created()
        } catch { failure = error.localizedDescription }
    }
}
