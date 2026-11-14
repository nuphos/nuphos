import SwiftUI

/// Desktop's Archived entry at the bottom of Tasks, opened: the viewer's
/// archived conversations, newest archived first. A row opens its chat to
/// read; swiping it unarchives it.
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
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) { unarchive(row) }
                    .contextMenu { unarchive(row) }
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
            .overlay {
                if store.archived.isEmpty, !store.archivedFailed {
                    Text("Nothing archived").font(Theme.Text.label).foregroundStyle(Theme.muted)
                }
            }
        }
    }

    private func unarchive(_ row: AgentConversation) -> some View {
        Button { Task { await store.unarchive(row) } } label: {
            Label("Unarchive", systemImage: "tray.and.arrow.up")
        }
        .tint(.blue)
    }
}
