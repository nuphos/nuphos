import SwiftUI

/// The "Add connector" catalog. OAuth and GitHub App connectors start their
/// browser flow straight from the row; credential connectors push a form.
struct AddConnectorSheet: View {
    let teamId: String

    @Environment(ConnectorsStore.self) private var connectors
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var formTarget: Connector?

    private var sections: [(category: Connector.Category, connectors: [Connector])] {
        let needle = search.trimmingCharacters(in: .whitespaces).lowercased()
        return Connector.Category.allCases.compactMap { category in
            let items = Connector.all.filter {
                $0.category == category && $0.isConnectable
                    && (needle.isEmpty || $0.title.lowercased().contains(needle) || $0.key.contains(needle))
            }
            return items.isEmpty ? nil : (category, items)
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if sections.isEmpty {
                    ContentUnavailableView.search(text: search)
                } else {
                    List {
                        ForEach(sections, id: \.category) { section in
                            Section(section.category.title) {
                                ForEach(section.connectors) { connector in
                                    row(connector)
                                }
                            }
                            .listRowBackground(Theme.surface)
                        }
                    }
                    .scrollContentBackground(.hidden)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.canvas)
            .searchable(text: $search, prompt: "Search connectors")
            .navigationTitle("Add connector")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .navigationDestination(item: $formTarget) { connector in
                ConnectorFormSheet(connector: connector, teamId: teamId) { dismiss() }
                    .environment(connectors)
            }
        }
        .interactiveDismissDisabled(connectors.connecting != nil)
    }

    @ViewBuilder
    private func row(_ connector: Connector) -> some View {
        Button {
            start(connector)
        } label: {
            HStack(spacing: 12) {
                BrandLogo(name: connector.logo, size: 20).foregroundStyle(Theme.heading)
                Text(connector.title).font(.system(size: 15)).foregroundStyle(Theme.heading)
                Spacer(minLength: 0)
                if connectors.connecting == connector.key {
                    ProgressView().controlSize(.small).tint(Theme.muted)
                } else {
                    Image(systemName: chevron(connector))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(connectors.connecting != nil)
    }

    /// An arrow for the flows that leave the app, a chevron for the ones that
    /// push a form — the row should say which before it is tapped.
    private func chevron(_ connector: Connector) -> String {
        if case .form = connector.bind { return "chevron.right" }
        return "arrow.up.right"
    }

    private func start(_ connector: Connector) {
        if case .form = connector.bind {
            formTarget = connector
            return
        }
        Task {
            if await connectors.connect(connector, teamId: teamId) { dismiss() }
        }
    }
}
