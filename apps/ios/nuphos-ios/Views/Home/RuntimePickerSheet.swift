import SwiftUI

/// Picks the agent a new conversation starts on: one of the user's own
/// computers, or a Cloud agent the team has connected.
struct RuntimePickerSheet: View {
    @Environment(AgentStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var showSetup = false
    @State private var loginRuntime: RuntimeInstance?

    var body: some View {
        NavigationStack {
            Group {
                if store.runtimesLoaded, store.runtimes.isEmpty {
                    ContentUnavailableView("No agents", systemImage: "cpu", description: Text("Set up a cloud agent here, or open Nuphos on your computer to connect your own local agent."))
                } else if !store.runtimesLoaded, let error = store.runtimesError {
                    ContentUnavailableView {
                        Label("Couldn't load agents", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Try again") { Task { await store.loadRuntimes(force: true) } }.buttonStyle(.bordered)
                    }
                } else if !store.runtimesLoaded {
                    ProgressView("Loading agents…").tint(Theme.muted)
                } else {
                    List {
                        if store.selectedRuntimeUnavailable {
                            Text("Your last agent is offline or signed out. Choose another one.")
                                .font(.system(size: 13)).foregroundStyle(Theme.muted)
                                .listRowBackground(Color.clear)
                        }
                        ForEach(RuntimeInstance.grouped(store.runtimes), id: \.tier) { group in
                            Section(group.tier.title) {
                                ForEach(group.runtimes) { runtime in
                                    Button {
                                        store.selectRuntime(runtime)
                                        dismiss()
                                    } label: {
                                        RuntimeRow(runtime: runtime, selected: runtime.id == store.newConversationRuntime?.id)
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(!runtime.isSelectable)
                                    if store.selectedTeam?.isAdministrator == true, runtime.tier == .cloud {
                                        Button("Sign in to \(runtime.label)") { loginRuntime = runtime }
                                    }
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
            .navigationTitle("Agent")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    if store.selectedTeam?.isAdministrator == true { Button("Add agent", systemImage: "plus") { showSetup = true } }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .sheet(isPresented: $showSetup) { if let team = store.selectedTeam { AgentSetupSheet(team: team) } }
            .sheet(item: $loginRuntime) { runtime in if let team = store.selectedTeam { AgentSetupSheet(team: team, runtime: runtime) } }
            .task { await store.loadRuntimes() }
            .refreshable { await store.loadRuntimes(force: true) }
        }
        .tint(Theme.heading)
        .presentationDetents([.medium, .large])
    }
}

private struct RuntimeRow: View {
    let runtime: RuntimeInstance
    let selected: Bool

    var body: some View {
        HStack(spacing: 14) {
            BrandLogo(name: RuntimeInstance.Provider.logo(runtime.provider.rawValue), size: 20)
                .frame(width: 28)
                .foregroundStyle(runtime.isSelectable ? Theme.heading : Theme.muted)
                .opacity(runtime.isSelectable ? 1 : 0.5)
            VStack(alignment: .leading, spacing: 3) {
                Text(runtime.name).font(.system(size: 15, weight: .medium)).foregroundStyle(runtime.isSelectable ? Theme.heading : Theme.muted)
                if let subtitle = runtime.subtitle {
                    Text(subtitle).font(.system(size: 13)).foregroundStyle(Theme.muted).lineLimit(2)
                }
            }
            Spacer()
            if selected {
                Image(systemName: "checkmark").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.heading)
            }
        }
        .padding(.vertical, 4)
    }
}

/// Model, effort and fast-mode controls for one conversation.
struct ModelSettingsSheet: View {
    var session: ChatSession?
    @Environment(AgentStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    private var config: SessionConfigState? { if let session { session.sessionConfig } else { store.newModelConfig } }
    private var error: String? { if let session { session.sessionConfigError } else { store.newModelError } }
    private var saving: Bool { session?.sessionConfigSaving ?? store.newModelSaving }

    private func refresh() async {
        if let session { await session.refreshSessionConfig() }
        else { await store.loadNewModelConfig() }
    }

    private func select(_ id: String, _ value: String) async {
        if let session { await session.setSessionConfig(configId: id, value: value) }
        else { await store.setNewModelConfig(configId: id, value: value) }
    }

    var body: some View {
        NavigationStack {
            Group {
                if let config, !config.options.isEmpty {
                    List {
                        if let hint = session?.pendingModelSettings.isEmpty == false ? "Changes apply after this reply." : config.hint {
                            Text(hint).font(.system(size: 13)).foregroundStyle(Theme.muted).listRowBackground(Color.clear)
                        }
                        if let error {
                            Text(error).font(.system(size: 13)).foregroundStyle(.red).listRowBackground(Color.clear)
                            Button("Try again") { Task { await refresh() } }.disabled(saving)
                        }
                        ForEach(config.options) { option in
                            Section(option.name) {
                                ForEach(option.options.filter { option.kind == .fast || ($0.value.lowercased() != "default" && !["default", "default model", "agent default", "runtime default"].contains($0.name.lowercased())) }) { choice in
                                    Button {
                                        Task { await select(option.id, choice.value) }
                                    } label: {
                                        HStack {
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(choice.name).font(.system(size: 15)).foregroundStyle(Theme.heading)
                                                if let d = choice.description, !d.isEmpty {
                                                    Text(d).font(.system(size: 12)).foregroundStyle(Theme.muted)
                                                }
                                            }
                                            Spacer()
                                            if choice.value == (session?.pendingModelSettings[option.id] ?? option.currentValue) {
                                                Image(systemName: "checkmark").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.heading)
                                            }
                                        }
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(!config.isEditable || saving || (session != nil && (session?.canManage != true || error != nil)))
                                }
                            }
                            .listRowBackground(Theme.surface)
                        }
                    }
                    .scrollContentBackground(.hidden)
                } else if let error {
                    ContentUnavailableView {
                        Label("Couldn't load model settings", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Try again") { Task { await refresh() } }.buttonStyle(.bordered)
                    }
                } else if let config {
                    ContentUnavailableView(config.modelTitle, systemImage: "slider.horizontal.3", description: Text(config.hint ?? ""))
                } else {
                    ProgressView("Getting model settings…").tint(Theme.muted)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.canvas)
            .navigationTitle("Model")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { await refresh() }
            .refreshable { await refresh() }
        }
        .tint(Theme.heading)
        .presentationDetents([.medium, .large])
    }
}
