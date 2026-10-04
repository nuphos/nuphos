import SwiftUI

/// Picks the IAM a new conversation may use, grouped by provider.
struct CredentialPickerSheet: View {
    @Environment(AgentStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Binding var selection: CredentialSelection

    var body: some View {
        NavigationStack {
            Group {
                if let catalog = store.credentialCatalog {
                    if catalog.isEmpty {
                        ContentUnavailableView("No IAM connected", systemImage: "key", description: Text("Connect cloud accounts and integrations in Nuphos to use them here."))
                    } else {
                        List {
                            ForEach(catalog.sections, id: \.provider.id) { section in
                                Section {
                                    ForEach(section.items) { item in
                                        Button {
                                            selection.toggle(item)
                                        } label: {
                                            HStack(spacing: 12) {
                                                VStack(alignment: .leading, spacing: 2) {
                                                    Text(item.label).font(.system(size: 15)).foregroundStyle(Theme.heading)
                                                    if let detail = item.detail {
                                                        Text(detail).font(.system(size: 12)).foregroundStyle(Theme.muted).lineLimit(1)
                                                    }
                                                }
                                                Spacer()
                                                Image(systemName: selection.contains(item) ? "checkmark.circle.fill" : "circle")
                                                    .font(.system(size: 20))
                                                    .foregroundStyle(selection.contains(item) ? Theme.heading : Theme.muted)
                                            }
                                        }
                                        .buttonStyle(.plain)
                                    }
                                } header: {
                                    HStack(spacing: 8) {
                                        if let symbol = section.provider.symbol {
                                            Image(systemName: symbol).font(.system(size: 13))
                                        } else {
                                            BrandLogo(name: section.provider.logo, size: 16)
                                        }
                                        Text(section.provider.title)
                                    }
                                }
                                .listRowBackground(Theme.surface)
                            }
                        }
                        .scrollContentBackground(.hidden)
                    }
                } else if let error = store.credentialCatalogError {
                    ContentUnavailableView {
                        Label("Couldn't load IAM", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Try again") { Task { await store.loadCredentialOptions(force: true) } }
                            .buttonStyle(.bordered)
                    }
                } else {
                    ProgressView("Loading IAM…").tint(Theme.muted)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.canvas)
            .navigationTitle("IAM")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if let catalog = store.credentialCatalog, !catalog.isEmpty {
                        if selection.containsAll(in: catalog) {
                            Button("Clear all") { selection.clearAll() }
                        } else {
                            Button("Select all") { selection.selectAll(in: catalog) }
                        }
                    }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { await store.loadCredentialOptions() }
            .refreshable { await store.loadCredentialOptions(force: true) }
        }
        .tint(Theme.heading)
        .presentationDetents([.medium, .large])
    }
}

/// The two chips above a composer: IAM and permission mode. Bound to the
/// store on the home page (defaults for new chats) or to a session.
struct ComposerControls: View {
    @Environment(AgentStore.self) private var store
    @Binding var selection: CredentialSelection
    @Binding var mode: PermissionMode
    /// The open conversation; nil on the home composer (a new chat).
    var session: ChatSession?
    @State private var showPicker = false
    @State private var showModes = false
    @State private var showRuntimes = false
    @State private var showModel = false

    var body: some View {
        runtimeChip

        Button { showPicker = true } label: {
            ComposerChip(systemImage: "key", title: iamTitle, isActive: !selection.isEmpty)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Choose IAM")
        .sheet(isPresented: $showPicker) { CredentialPickerSheet(selection: $selection) }
        #if DEBUG
        .onAppear { if ProcessInfo.processInfo.arguments.contains("-show-iam") { showPicker = true } }
        #endif

        Button { showModes = true } label: {
            ComposerChip(systemImage: mode.systemImage, title: mode.title, isActive: mode == .bypass)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Permission mode")
        .sheet(isPresented: $showModes) { PermissionModeSheet(mode: $mode) }
        #if DEBUG
        .onAppear { if ProcessInfo.processInfo.arguments.contains("-show-modes") { showModes = true } }
        #endif

        if let session, !session.isNew, session.isNativeRuntime, session.sessionConfig?.status != .unsupported {
            Button { showModel = true } label: {
                ComposerChip(systemImage: session.sessionConfig?.isFast == true ? "bolt.fill" : "cpu", title: modelTitle(session), isActive: false)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Model settings")
            .sheet(isPresented: $showModel) { ModelSettingsSheet(session: session) }
        }
    }

    /// Only a new chat picks its runtime; an existing one reads it under the
    /// title, where it does not take a slot in the composer's control row.
    @ViewBuilder
    private var runtimeChip: some View {
        if session?.isNew == false {
            EmptyView()
        } else {
            Button { showRuntimes = true } label: {
                ComposerChip(logo: RuntimeInstance.Provider.logo(store.newConversationRuntime?.provider.rawValue), title: runtimeTitle, isActive: store.newConversationRuntime != nil)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Choose agent")
            .sheet(isPresented: $showRuntimes) { RuntimePickerSheet() }
            .task { await store.loadRuntimes() }
        }
    }

    private var runtimeTitle: String {
        guard let runtime = store.newConversationRuntime else {
            if store.selectedRuntimeUnavailable { return "Choose agent" }
            return store.runtimesLoaded ? "Agent" : "Agent…"
        }
        return runtime.name
    }

    private func modelTitle(_ session: ChatSession) -> String {
        session.sessionConfig?.modelTitle ?? "Model"
    }

    private var iamTitle: String {
        let n = selection.count
        return n == 0 ? "IAM" : "IAM · \(n)"
    }
}

struct PermissionModeSheet: View {
    @Binding var mode: PermissionMode
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(PermissionMode.allCases) { option in
                    Button {
                        mode = option
                        dismiss()
                    } label: {
                        HStack(spacing: 14) {
                            Image(systemName: option.systemImage)
                                .font(.system(size: 18, weight: .medium))
                                .frame(width: 28)
                                .foregroundStyle(option == .bypass ? Color.orange : Theme.heading)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(option.title).font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.heading)
                                Text(option.subtitle).font(.system(size: 13)).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            if option == mode {
                                Image(systemName: "checkmark").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.heading)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                }
                .listRowBackground(Theme.surface)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.canvas)
            .navigationTitle("Permissions")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .tint(Theme.heading)
        .presentationDetents([.height(260)])
        .presentationDragIndicator(.visible)
    }
}
