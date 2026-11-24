import SwiftUI

/// Desktop's Archived entry at the bottom of Tasks, opened: the viewer's
/// archived conversations, newest archived first. A row opens its chat, which
/// can restore it from there.
struct ArchivedList: View {
    let open: (AgentConversation) -> Void
    @Environment(AgentStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(store.archived) { row in
                    Button { open(row) } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(row.displayTitle)
                                .font(Theme.Text.body.weight(.medium))
                                .foregroundStyle(Theme.heading)
                                .lineLimit(1)
                            Text(HistoryTime.format(row.lastActiveAt))
                                .font(Theme.Text.label)
                                .foregroundStyle(Theme.muted)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                if store.archivedFailed {
                    Button("Retry") { Task { await store.loadArchived(more: !store.archived.isEmpty) } }
                } else if store.archivedHasMore {
                    Button("Load more") { Task { await store.loadArchived(more: true) } }
                }
            }
            .listStyle(.plain)
            .navigationTitle("Archived")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            // Opened, it reads the list again, as Desktop's does.
            .task { await store.loadArchived() }
        }
    }
}
