import SwiftUI

/// The team's runtimes, like Desktop's Runtimes page: each Box, computer or
/// the Cloud with its live load, then its runtimes with their usage. A row
/// opens that runtime's page, its sign-in, or how to sign it in elsewhere.
struct RuntimesPage: View {
    @Environment(AgentStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    /// A computer's own desktop, opened from its box.
    @State private var showSetup = false
    @State private var showWorkspaceSetup = false
    @State private var desktop: DesktopSession?

    /// Like Desktop's Computers page, every computer is listed, one with no runtimes too.
    private var boxes: [SelectorBox] {
        let grouped = SelectorBox.grouped(store.runtimes, devices: store.agentDevices)
        let empty = store.agentDevices.filter { device in !grouped.contains { $0.id == "device:\(device.deviceId)" } }
        return grouped + empty.map { SelectorBox(id: "device:\($0.deviceId)", label: $0.label, device: $0, agents: []) }
    }

    var body: some View {
        // Pushed views do not inherit the store here, so they are handed this one.
        let store = store
        return Group {
            if store.phase == .loaded, store.selectedTeam == nil {
                SetupEmptyState(title: "No workspace yet", message: "Create or join a workspace before connecting a computer.", actionTitle: "Set up workspace") { showWorkspaceSetup = true }
            } else if !store.runtimesLoaded, let error = store.runtimesError {
                ContentUnavailableView {
                    Label("Couldn't load runtimes", image: "lucide-wifi-off")
                } description: { Text(error) } actions: {
                    Button("Try again") { Task { await store.loadRuntimes(force: true) } }.buttonStyle(.bordered)
                }
            } else if !store.runtimesLoaded {
                ProgressView().tint(Theme.muted)
            } else if boxes.isEmpty {
                SetupEmptyState(title: "Connect your first runtime", message: "Connect a computer so your Bots and tasks have a place to work.", actionTitle: "Set up a computer") { showSetup = true }
            } else { list }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.canvas)
        // Full screen even where wide: beside this list, the list itself would be put away.
        .sheet(isPresented: $showSetup) { RuntimeSetupGuide() }
        .sheet(isPresented: $showWorkspaceSetup) { WorkspaceSetupSheet() }
        .desktop($desktop)
        .environment(\.desktopBeside, nil)
        .task(id: store.selectedTeam?.id) {
            if store.teams.isEmpty { await store.loadTeams() }
            async let agents: Void = store.loadRuntimes(force: true)
            async let quotas: Void = store.loadQuotas()
            _ = await (agents, quotas)
        }
        .task(id: "\(store.selectedTeam?.id ?? ""): \(scenePhase == .active)") {
            guard scenePhase == .active else { return }
            await store.pollAgentDevices()
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
                ContentUnavailableView("No runtimes", image: "lucide-cpu", description: Text("Open Nuphos on your computer to connect it and add a runtime."))
                    .listRowBackground(Color.clear)
            }
            ForEach(boxes) { box in
                Section {
                    SelectorBoxHeader(box: box, current: false, expanded: true, metricsUnavailable: store.agentDevicesError, showsChevron: false)
                        .listRowInsets(EdgeInsets(top: 16, leading: 20, bottom: 16, trailing: 20))
                    // The backend names it only for a computer the viewer may open; it needs no runtime.
                    if let runtimeId = box.device?.desktopRuntimeId, let team = store.selectedTeam {
                        Button {
                            desktop = .computer(teamId: team.id, runtimeId: runtimeId, token: store.token)
                        } label: {
                            Label { Text("Open computer desktop") } icon: { LucideIcon("monitor") }
                                .font(.system(size: 15)).foregroundStyle(Theme.heading)
                        }
                        .accessibilityIdentifier("desktop-\(box.id)")
                        .listRowInsets(EdgeInsets(top: 12, leading: 44, bottom: 12, trailing: 20))
                    }
                    ForEach(box.agents) { runtime in
                        NavigationLink {
                            RuntimeDestination(runtime: runtime).environment(store)
                        } label: {
                            SelectorAgentRow(runtime: runtime, quota: store.quotas[runtime.id], selected: false)
                        }
                        .listRowInsets(EdgeInsets(top: 12, leading: 44, bottom: 12, trailing: 20))
                    }
                    if box.agents.isEmpty, let device = box.device, device.box == nil {
                        Text(device.access == "use"
                            ? "No runtime yet. Ask its owner to add one."
                            : "No runtime yet. Install Claude Code or Codex on \(device.label) and sign in.")
                            .font(.system(size: 13)).foregroundStyle(Theme.muted)
                            .listRowInsets(EdgeInsets(top: 12, leading: 44, bottom: 12, trailing: 20))
                    }
                }
                .listRowBackground(Theme.surface)
            }
        }
        .listSectionSpacing(20)
        .listRowSeparator(.hidden)
        .scrollContentBackground(.hidden)
    }
}

/// Where a runtime row leads: its own page, its sign-in, or how to sign it in elsewhere.
/// A view of its own, so it reads the store where it is shown.
private struct RuntimeDestination: View {
    @Environment(AgentStore.self) private var store
    let runtime: RuntimeInstance

    var body: some View {
        if let team = store.selectedTeam {
            if runtime.tier == .cloud, team.isAdministrator {
                AgentDetailView(team: team, runtime: runtime)
            } else if SelectorBox.grouped(store.runtimes, devices: store.agentDevices)
                .first(where: { $0.agents.contains(runtime) })?.canSignIn(runtime, administrator: team.isAdministrator) == true {
                AgentSetupView(team: team, runtime: runtime, selectOnCompletion: false)
            } else {
                AgentSignInInstructions(runtime: runtime, teammate: runtime.local.map { $0.ownerUserId != store.userId } ?? false)
            }
        }
    }
}

private struct AgentSignInInstructions: View {
    let runtime: RuntimeInstance
    /// A teammate's computer: only its owner can sign it in.
    var teammate = false

    var body: some View {
        List {
            VStack(spacing: 12) {
                BrandLogo(name: RuntimeInstance.Provider.logo(runtime.provider.rawValue), size: 56)
                Text(title).font(.title3.weight(.semibold))
                Text(RuntimeInstance.Provider.detail(runtime.provider.rawValue, instance: runtime.label)).font(.subheadline).foregroundStyle(Theme.muted)
                Text(steps)
                    .font(.subheadline).foregroundStyle(Theme.body).multilineTextAlignment(.center)
            }.frame(maxWidth: .infinity).padding(.vertical, 16).listRowBackground(Color.clear)
        }.listRowSeparator(.hidden)
        .scrollContentBackground(.hidden).background(Theme.canvas).navigationTitle("Sign in").navigationBarTitleDisplayMode(.inline)
    }

    private var title: String {
        guard let local = runtime.local else { return String(localized: "Ask an administrator to sign in") }
        return teammate ? String(localized: "Ask its owner to sign in") : String(localized: "Sign in on \(local.deviceLabel)")
    }

    /// The Runtimes page is in Nuphos on a computer, not in this app.
    private var steps: String {
        guard let local = runtime.local else {
            return String(localized: "A workspace administrator can sign it in from the Runtimes page in Nuphos on their computer.")
        }
        return teammate
            ? String(localized: "\(local.deviceLabel) belongs to a teammate, so only they can sign it in. Ask them to open Nuphos on it and choose Sign in on the Runtimes page.")
            : String(localized: "On \(local.deviceLabel), open Nuphos, go to the Runtimes page and choose Sign in for this runtime.")
    }
}
