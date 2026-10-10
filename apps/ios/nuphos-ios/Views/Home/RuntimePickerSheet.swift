import SwiftUI

/// Picks the agent a new conversation starts on: one of the user's own
/// computers, or a Cloud agent the team has connected.
struct RuntimePickerSheet: View {
    @Environment(AgentStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var showSetup = false
    @State private var loginRuntime: RuntimeInstance?
    @State private var detent = PresentationDetent.medium

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
                                    let quota = store.quotas[runtime.id]
                                    HStack(spacing: 12) {
                                        Button {
                                            if quota?.needsSignIn == true, store.canSignIn(runtime) {
                                                loginRuntime = runtime
                                            } else {
                                                store.selectRuntime(runtime)
                                                dismiss()
                                            }
                                        } label: {
                                            RuntimeRow(runtime: runtime, quota: quota, selected: runtime.id == store.newConversationRuntime?.id)
                                        }
                                        .buttonStyle(.plain)
                                        .disabled(!runtime.isSelectable)
                                        // A signed-out agent says so in its row; this covers the ones
                                        // whose provider can't report it.
                                        if store.canSignIn(runtime) {
                                            Button("Sign In Again", systemImage: "person.badge.key") { loginRuntime = runtime }
                                                .labelStyle(.iconOnly)
                                                .buttonStyle(.borderless)
                                                .foregroundStyle(Theme.muted)
                                        }
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
            .navigationDestination(isPresented: $showSetup) { if let team = store.selectedTeam { AgentSetupView(team: team) } }
            .navigationDestination(item: $loginRuntime) { runtime in if let team = store.selectedTeam { AgentSetupView(team: team, runtime: runtime) } }
            .task { await store.loadRuntimes() }
            .task { await store.loadQuotas() }
            .refreshable {
                async let runtimes: Void = store.loadRuntimes(force: true)
                async let quotas: Void = store.loadQuotas()
                _ = await (runtimes, quotas)
            }
        }
        .tint(Theme.heading)
        .presentationDetents([.medium, .large], selection: $detent)
        // Setting an agent up needs the whole sheet; the list does not.
        .onChange(of: showSetup || loginRuntime != nil) { _, open in if open { detent = .large } }
    }
}

private struct RuntimeRow: View {
    let runtime: RuntimeInstance
    let quota: RuntimeQuota?
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
                if let quota { QuotaLine(quota: quota) }
            }
            Spacer()
            if selected {
                Image(systemName: "checkmark").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.heading)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
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
                                        .contentShape(Rectangle())
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

/// "62% left · resets in 2 hr" for the window closest to its limit,
/// or the reason there's nothing to show.
private struct QuotaLine: View {
    let quota: RuntimeQuota

    var body: some View {
        if let window = quota.tightest {
            let left = max(0, Int((100 - window.usedPercent).rounded(.down)))
            HStack(spacing: 6) {
                Gauge(value: min(window.usedPercent, 100), in: 0...100) { EmptyView() }
                    .gaugeStyle(.accessoryLinearCapacity)
                    .tint(tone(window.usedPercent))
                    .frame(width: 44)
                    .scaleEffect(y: 0.8)
                Text([left == 0 ? "Limit reached" : "\(left)% left", reset(window.resetsAt)].compactMap(\.self).joined(separator: " · "))
                    .font(.system(size: 12))
                    .monospacedDigit()
                    .foregroundStyle(window.usedPercent >= 80 ? tone(window.usedPercent) : Theme.muted)
            }
            .accessibilityElement(children: .combine)
        } else if quota.needsSignIn {
            Text("\(Image(systemName: "exclamationmark.circle.fill")) Sign in required")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.warning)
        }
    }

    private func tone(_ used: Double) -> Color {
        used >= 100 ? .red : used >= 80 ? Theme.warning : Theme.heading
    }

    private func reset(_ date: Date?) -> String? {
        guard let date, date > .now else { return nil }
        let minutes = Int(date.timeIntervalSinceNow / 60)
        if minutes < 24 * 60 {
            return minutes < 60 ? "resets in \(max(1, minutes))m" : "resets in \(minutes / 60)h \(minutes % 60)m"
        }
        return "resets " + date.formatted(.dateTime.weekday(.abbreviated).hour().minute())
    }
}
