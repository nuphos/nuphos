import SwiftUI

/// The team's connectors: what is bound, grouped the way the desktop's
/// catalog groups it, plus the "Add connector" entry point. Administrators
/// can connect from here; everyone else reads.
struct ConnectorsPage: View {
    @Environment(AgentStore.self) private var store
    @Environment(ConnectorsStore.self) private var connectors

    @State private var adding = false

    private var team: Team? { store.selectedTeam }
    private var canConnect: Bool { team?.isAdministrator == true }

    var body: some View {
        @Bindable var connectors = connectors

        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.canvas)
            .sheet(isPresented: $adding) {
                AddConnectorSheet(teamId: team?.id ?? "")
                    .environment(connectors)
            }
            .alert(
                "Couldn't connect",
                isPresented: Binding(get: { connectors.connectError != nil }, set: { if !$0 { connectors.connectError = nil } })
            ) {
                Button("OK") { connectors.connectError = nil }
            } message: {
                Text(connectors.connectError ?? "")
            }
            .task(id: team?.id) {
                if let id = team?.id { await connectors.load(teamId: id) }
            }
            .refreshable {
                if let id = team?.id { await connectors.load(teamId: id, force: true) }
            }
    }

    /// A reload failure with a list already on screen keeps the list: the
    /// rows are still true, and pull-to-refresh is the retry.
    @ViewBuilder
    private var content: some View {
        if connectors.inventory != nil {
            list
        } else if case .failed(let message) = connectors.phase {
            ContentUnavailableView {
                Label("Couldn't load connectors", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try again") {
                    if let id = team?.id { Task { await connectors.load(teamId: id, force: true) } }
                }
                .buttonStyle(.bordered)
            }
        } else {
            ProgressView().tint(Theme.muted)
        }
    }

    private var sections: [(category: Connector.Category, connectors: [Connector])] {
        connectors.inventory?.boundSections ?? []
    }

    @ViewBuilder
    private var list: some View {
        if sections.isEmpty {
            ContentUnavailableView {
                Label("No connectors yet", systemImage: "app.connected.to.app.below.fill")
            } description: {
                Text(canConnect
                     ? "Connect a cloud account or an integration to let the agent work in it."
                     : "A team administrator can connect cloud accounts and integrations.")
            } actions: {
                if canConnect {
                    Button("Add connector") { adding = true }
                        .prominentButton()
                }
            }
        } else {
            List {
                ForEach(sections, id: \.category) { section in
                    Section(section.category.title) {
                        ForEach(section.connectors) { connector in
                            ForEach(connectors.inventory?.bindings(for: connector) ?? []) { binding in
                                BindingRow(connector: connector, binding: binding)
                            }
                        }
                    }
                    .listRowBackground(Theme.surface)
                }

                if canConnect {
                    Section {
                        Button {
                            adding = true
                        } label: {
                            Label("Add connector", systemImage: "plus")
                                .font(.system(size: 15))
                                .foregroundStyle(Theme.brandText)
                        }
                    }
                    .listRowBackground(Theme.surface)
                }
            }
            .scrollContentBackground(.hidden)
        }
    }
}

private struct BindingRow: View {
    let connector: Connector
    let binding: ConnectorBinding

    var body: some View {
        HStack(spacing: 12) {
            BrandLogo(name: connector.logo, size: 20)
                .foregroundStyle(Theme.heading)
            VStack(alignment: .leading, spacing: 2) {
                Text(binding.label)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.heading)
                Text(binding.detail ?? connector.title)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
    }
}
