import SwiftUI

/// The team's runtimes, like Desktop's Runtimes page: each Box, computer or
/// the Cloud with its live load, then its runtimes with their usage. A row
/// opens that runtime's page, its sign-in, or how to sign it in elsewhere.
struct RuntimesPage: View {
    @Environment(AgentStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var showSetup = false

    private var boxes: [SelectorBox] { SelectorBox.grouped(store.runtimes, devices: store.agentDevices) }
    private var administrator: Bool { store.selectedTeam?.isAdministrator == true }

    var body: some View {
        Group {
            if !store.runtimesLoaded, let error = store.runtimesError {
                ContentUnavailableView {
                    Label("Couldn't load runtimes", systemImage: "wifi.exclamationmark")
                } description: { Text(error) } actions: {
                    Button("Try again") { Task { await store.loadRuntimes(force: true) } }.buttonStyle(.bordered)
                }
            } else if !store.runtimesLoaded {
                ProgressView().tint(Theme.muted)
            } else { list }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.canvas)
        .navigationDestination(for: RuntimeInstance.self) { destination($0) }
        .navigationDestination(isPresented: $showSetup) { if let team = store.selectedTeam { AgentSetupView(team: team, selectOnCompletion: false) } }
        .task(id: store.selectedTeam?.id) {
            async let agents: Void = store.loadRuntimes(force: true)
            async let quotas: Void = store.loadQuotas()
            _ = await (agents, quotas)
        }
        .task(id: "\(store.selectedTeam?.id ?? ""): \(scenePhase == .active)") {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await store.loadAgentDevices()
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
            }
        }
        .refreshable {
            async let agents: Void = store.loadRuntimes(force: true)
            async let quotas: Void = store.loadQuotas()
            async let devices: Void = store.loadAgentDevices()
            _ = await (agents, quotas, devices)
        }
    }

    private var list: some View {
        List {
            if boxes.isEmpty {
                ContentUnavailableView("No runtimes", systemImage: "cpu", description: Text(administrator
                    ? "Add a cloud runtime here, or open Nuphos on your computer to connect a runtime."
                    : "Ask a workspace administrator to add a runtime."))
                    .listRowBackground(Color.clear)
            }
            ForEach(boxes) { box in
                Section {
                    SelectorBoxHeader(box: box, current: false, expanded: true, metricsUnavailable: store.agentDevicesError, showsChevron: false)
                        .listRowInsets(EdgeInsets(top: 16, leading: 20, bottom: 16, trailing: 20))
                    ForEach(box.agents) { runtime in
                        NavigationLink(value: runtime) {
                            SelectorAgentRow(runtime: runtime, quota: store.quotas[runtime.id], selected: false)
                        }
                        .listRowInsets(EdgeInsets(top: 12, leading: 20, bottom: 12, trailing: 20))
                    }
                }
                .listRowBackground(Theme.surface)
            }
            if administrator {
                Section {
                    Button { showSetup = true } label: {
                        Label("Add runtime", systemImage: "plus").font(.system(size: 15)).foregroundStyle(Theme.brandText)
                    }
                }
                .listRowBackground(Theme.surface)
            }
        }
        .listSectionSpacing(20)
        .scrollContentBackground(.hidden)
    }

    @ViewBuilder
    private func destination(_ runtime: RuntimeInstance) -> some View {
        if let team = store.selectedTeam {
            if runtime.tier == .cloud, team.isAdministrator {
                AgentDetailView(team: team, runtime: runtime)
            } else if boxes.first(where: { $0.agents.contains(runtime) })?.canSignIn(runtime, administrator: team.isAdministrator) == true {
                AgentSetupView(team: team, runtime: runtime, selectOnCompletion: false)
            } else {
                AgentSignInInstructions(runtime: runtime)
            }
        }
    }
}

private struct AgentSignInInstructions: View {
    let runtime: RuntimeInstance
    var body: some View {
        List {
            VStack(spacing: 12) {
                BrandLogo(name: RuntimeInstance.Provider.logo(runtime.provider.rawValue), size: 56)
                Text(runtime.local.map { "Sign in on \($0.deviceLabel)" } ?? "Ask an administrator to sign in").font(.title3.weight(.semibold))
                Text(runtime.label).font(.subheadline).foregroundStyle(Theme.muted)
                Text(runtime.local.map { "Open Nuphos on \($0.deviceLabel), go to Settings → Runtimes, then choose Sign in for this runtime." } ?? "A workspace administrator can sign in to this runtime in Settings → Runtimes.")
                    .font(.subheadline).foregroundStyle(Theme.body).multilineTextAlignment(.center)
            }.frame(maxWidth: .infinity).padding(.vertical, 16).listRowBackground(Color.clear)
        }.scrollContentBackground(.hidden).background(Theme.canvas).navigationTitle("Sign in").navigationBarTitleDisplayMode(.inline)
    }
}
