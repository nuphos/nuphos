import SwiftUI

/// Picks the Credentials a new conversation may use, grouped by provider.
struct CredentialPickerSheet: View {
    @Environment(AgentStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Binding var selection: CredentialSelection
    var scope: CredentialScope = .credentials

    private var title: String { scope == .devices ? "Devices" : "Credentials" }
    private var symbol: String { scope == .devices ? "laptopcomputer" : "key" }
    private var catalog: CredentialCatalog? { store.credentialCatalog?.scoped(to: scope) }

    var body: some View {
        NavigationStack {
            Group {
                if let catalog {
                    if catalog.isEmpty {
                        ContentUnavailableView("No \(title) connected", systemImage: symbol, description: Text(scope == .devices ? "Connect a device to your team in Nuphos to use it here." : "Connect cloud accounts and integrations in Nuphos to use them here."))
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
                        Label("Couldn't load \(title)", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Try again") { Task { await store.loadCredentialOptions(force: true) } }
                            .buttonStyle(.bordered)
                    }
                } else {
                    ProgressView("Loading \(title)…").tint(Theme.muted)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.canvas)
            .navigationTitle(title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if let catalog, !catalog.isEmpty {
                        if selection.containsAll(in: catalog) {
                            Button("Clear all") { selection.clearAll(scope: scope) }
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

/// Composer controls for credentials, devices, and permission mode. Bound to the
/// store on the home page (defaults for new chats) or to a session.
struct ComposerControls: View {
    @Environment(AgentStore.self) private var store
    @Binding var selection: CredentialSelection
    @Binding var mode: PermissionMode
    /// The open conversation; nil on the home composer (a new chat).
    var session: ChatSession?
    @State private var showDevices = false
    @State private var showPicker = false
    @State private var showModes = false
    @State private var showRuntimes = false
    @State private var showModel = false

    var body: some View {
        runtimeChip

        Button { showPicker = true } label: {
            ComposerChip(systemImage: "key", title: credentialsTitle, isActive: selection.count(in: .credentials) > 0)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Choose Credentials")
        .sheet(isPresented: $showPicker) { CredentialPickerSheet(selection: $selection) }
        #if DEBUG
        .onAppear { if ProcessInfo.processInfo.arguments.contains("-show-iam") { showPicker = true } }
        #endif

        Button { showDevices = true } label: {
            ComposerChip(systemImage: "laptopcomputer", title: deviceTitle, isActive: selection.count(in: .devices) > 0)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Choose devices")
        .sheet(isPresented: $showDevices) { CredentialPickerSheet(selection: $selection, scope: .devices) }

        Button { showModes = true } label: {
            ComposerChip(title: mode.title, isActive: mode == .bypass)
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
            .task(id: session.sessionId) {
                while !Task.isCancelled {
                    await session.refreshSessionConfig()
                    do { try await Task.sleep(for: .seconds(10)) } catch { return }
                }
            }
            .onChange(of: session.isStreaming) { _, streaming in
                if !streaming { Task { await session.refreshSessionConfig() } }
            }
        } else if session == nil || session?.isNew == true, store.canConfigureNewModel {
            Button { showModel = true } label: {
                ComposerChip(title: store.newModelTitle, isActive: false)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Model settings")
            .sheet(isPresented: $showModel) { ModelSettingsSheet() }
            .task(id: "\(store.selectedTeam?.id ?? "")/\(store.newConversationRuntime?.id ?? "")") {
                await store.loadNewModelConfig()
            }
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
        session.sessionConfig?.model.map { $0.currentLabel } ?? session.initialModelTitle ?? session.sessionConfig?.modelTitle ?? "Model"
    }

    private var deviceTitle: String {
        let n = selection.count(in: .devices)
        return n == 0 ? "Devices" : "Devices · \(n)"
    }

    private var credentialsTitle: String {
        let n = selection.count(in: .credentials)
        return n == 0 ? "Credentials" : "Credentials · \(n)"
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
