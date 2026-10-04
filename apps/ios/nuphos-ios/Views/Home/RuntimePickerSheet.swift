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
    @Bindable var session: ChatSession
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let config = session.sessionConfig, !config.options.isEmpty {
                    List {
                        if let hint = config.hint ?? (session.isStreaming ? "You can change model settings after this reply." : nil) {
                            Text(hint).font(.system(size: 13)).foregroundStyle(Theme.muted).listRowBackground(Color.clear)
                        }
                        if let error = session.sessionConfigError {
                            Text(error).font(.system(size: 13)).foregroundStyle(.red).listRowBackground(Color.clear)
                        }
                        ForEach(config.options) { option in
                            Section(option.name) {
                                ForEach(option.options.filter { option.kind == .fast || ($0.value.lowercased() != "default" && !["default", "default model", "agent default", "runtime default"].contains($0.name.lowercased())) }) { choice in
                                    Button {
                                        Task { await session.setSessionConfig(configId: option.id, value: choice.value) }
                                    } label: {
                                        HStack {
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(choice.name).font(.system(size: 15)).foregroundStyle(Theme.heading)
                                                if let d = choice.description, !d.isEmpty {
                                                    Text(d).font(.system(size: 12)).foregroundStyle(Theme.muted)
                                                }
                                            }
                                            Spacer()
                                            if choice.value == option.currentValue {
                                                Image(systemName: "checkmark").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.heading)
                                            }
                                        }
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .listRowBackground(Theme.surface)
                        }
                    }
                    .scrollContentBackground(.hidden)
                    .disabled(!config.isEditable || session.isStreaming || session.sessionConfigSaving)
                } else if let error = session.sessionConfigError {
                    ContentUnavailableView {
                        Label("Couldn't load model settings", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Try again") { Task { await session.refreshSessionConfig() } }.buttonStyle(.bordered)
                    }
                } else if let config = session.sessionConfig {
                    ContentUnavailableView(config.modelTitle, systemImage: "slider.horizontal.3", description: Text(config.hint ?? (session.isStreaming ? "You can change model settings after this reply." : "")))
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
            .task { if session.sessionConfig == nil { await session.refreshSessionConfig() } }
            .refreshable { await session.refreshSessionConfig() }
        }
        .tint(Theme.heading)
        .presentationDetents([.medium, .large])
    }
}
