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
                                Image(systemName: "checkmark.circle.fill")
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
            AsyncImage(url: team.avatarUrl.flatMap(URL.init(string:))) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                ZStack {
                    Theme.canvas
                    Text(String(team.name.prefix(2)).uppercased())
                        .font(.footnote.weight(.semibold)).foregroundStyle(Theme.body)
                }
            }
            .frame(width: 28, height: 28)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .accessibilityHidden(true)
            Text(team.name)
                .font(.body.weight(.medium)).foregroundStyle(Theme.heading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: 36)
    }
}
