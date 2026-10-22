import SwiftUI

/// Browsing a Box never changes the selected agent. Only an agent row selects or moves.
struct RuntimePickerSheet: View {
    var session: ChatSession?
    var onMove: (RuntimeInstance) -> Void = { _ in }
    @Environment(AgentStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var expanded: String?
    @State private var initialized = false
    @State private var showSetup = false
    @State private var managing = false
    @State private var signInRuntime: RuntimeInstance?
    @State private var howTo: RuntimeInstance?
    @State private var pendingLocal: RuntimeInstance?
    @State private var detent = PresentationDetent.height(720)

    private var selectedId: String? { session == nil ? store.newConversationRuntime?.id : session?.runtimeId }
    private var choices: [RuntimeInstance] {
        guard let session, !session.isOwner else { return store.runtimes }
        return store.runtimes.filter { $0.kind == "managed" }
    }
    private var boxes: [SelectorBox] { SelectorBox.grouped(choices, devices: store.agentDevices) }
    private var administrator: Bool { store.selectedTeam?.isAdministrator == true }
    private var browsing: Bool { !showSetup && !managing && signInRuntime == nil && howTo == nil && scenePhase == .active }

    var body: some View {
        NavigationStack {
            Group {
                if !store.runtimesLoaded, let error = store.runtimesError {
                    ContentUnavailableView {
                        Label("Couldn't load runtimes", systemImage: "wifi.exclamationmark")
                    } description: { Text(error) } actions: {
                        Button("Try again") { Task { await store.loadRuntimes(force: true) } }.buttonStyle(.bordered)
                    }
                } else if !store.runtimesLoaded {
                    ProgressView("Loading runtimes…").tint(Theme.muted)
                } else if choices.isEmpty {
                    ContentUnavailableView("No runtimes", systemImage: "cpu", description: Text("Set up a cloud runtime here, or open Nuphos on your computer to connect a runtime."))
                } else { boxList }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.canvas)
            .navigationTitle("Choose runtime")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }.labelStyle(.iconOnly).foregroundStyle(Theme.muted)
                }
                if administrator {
                    ToolbarItem(placement: .primaryAction) { Button("Add runtime", systemImage: "plus") { showSetup = true } }
                }
            }
            .navigationDestination(isPresented: $showSetup) { if let team = store.selectedTeam { AgentSetupView(team: team) } }
            .navigationDestination(item: $signInRuntime) { runtime in
                if let team = store.selectedTeam { AgentSetupView(team: team, runtime: runtime, selectOnCompletion: false) }
            }
            .navigationDestination(item: $howTo) { runtime in AgentSignInInstructions(runtime: runtime) }
            .navigationDestination(isPresented: $managing) { SelectorManagementView() }
            .alert("Move to \(pendingLocal?.label ?? "")?", isPresented: Binding(get: { pendingLocal != nil }, set: { if !$0 { pendingLocal = nil } }), presenting: pendingLocal) { runtime in
                Button("Move") { onMove(runtime); dismiss() }
                Button("Cancel", role: .cancel) {}
            } message: { _ in
                Text("This runtime runs on your computer. After the move, anyone in this team can open this session and run commands on your computer.")
            }
            .task(id: store.selectedTeam?.id) {
                initialized = false
                await store.loadRuntimes()
                openCurrentBox()
                await store.loadQuotas()
            }
            .task(id: "\(store.selectedTeam?.id ?? ""): \(browsing)") {
                guard browsing else { return }
                while !Task.isCancelled {
                    await store.loadAgentDevices()
                    do { try await Task.sleep(for: .seconds(5)) } catch { return }
                }
            }
            .onChange(of: store.runtimes) { _, _ in openCurrentBox() }
        }
        .tint(Theme.heading)
        .presentationDetents([.height(720), .large], selection: $detent)
        .onChange(of: showSetup || managing || signInRuntime != nil || howTo != nil) { _, open in if open { detent = .large } }
    }

    private var boxList: some View {
        ScrollViewReader { proxy in
            List {
                ForEach(boxes) { box in
                    Section {
                        Button { withAnimation(.snappy(duration: 0.25)) { expanded = expanded == box.id ? nil : box.id } } label: {
                            SelectorBoxHeader(box: box, current: box.agents.contains { $0.id == selectedId }, expanded: expanded == box.id, metricsUnavailable: store.agentDevicesError)
                        }
                        .buttonStyle(.plain)
                        .listRowInsets(EdgeInsets(top: 16, leading: 20, bottom: 16, trailing: 20))
                        .id(box.id)
                        .accessibilityIdentifier("box-\(box.id)")
                        .accessibilityValue(expanded == box.id ? "Expanded" : "Collapsed")
                        if expanded == box.id {
                            ForEach(box.agents) { runtime in
                                let signedOut = runtime.local?.signedIn == false || store.quotas[runtime.id]?.needsSignIn == true
                                let canSignIn = box.canSignIn(runtime, administrator: administrator)
                                Button {
                                    if signedOut {
                                        if canSignIn { signInRuntime = runtime } else { howTo = runtime }
                                    } else { select(runtime) }
                                } label: {
                                    SelectorAgentRow(runtime: runtime, quota: store.quotas[runtime.id], selected: runtime.id == selectedId, signedOut: signedOut, canSignIn: canSignIn)
                                        .padding(.leading, 12)
                                }
                                .buttonStyle(.plain)
                                .disabled(box.offline || (!signedOut && !runtime.isSelectable))
                                .accessibilityIdentifier("agent-\(runtime.id)")
                                .listRowInsets(EdgeInsets(top: 12, leading: 20, bottom: 12, trailing: 20))
                            }
                        }
                    }.listRowBackground(Theme.surface)
                }
                Section {
                    Button { managing = true } label: {
                        Label("Manage computers and runtimes", systemImage: "slider.horizontal.3").font(.system(size: 14)).foregroundStyle(Theme.body)
                    }
                }.listRowBackground(Theme.surface)
            }
            .listSectionSpacing(20)
            .contentMargins(.top, 16, for: .scrollContent)
            .scrollContentBackground(.hidden)
            .onChange(of: expanded) { _, id in if let id { withAnimation(.snappy(duration: 0.25)) { proxy.scrollTo(id, anchor: .top) } } }
            .onAppear { if let expanded { proxy.scrollTo(expanded, anchor: .top) } }
            .refreshable {
                async let agents: Void = store.loadRuntimes(force: true)
                async let quotas: Void = store.loadQuotas()
                async let devices: Void = store.loadAgentDevices()
                _ = await (agents, quotas, devices)
            }
        }
    }

    private func openCurrentBox() {
        guard !initialized, !boxes.isEmpty else { return }
        expanded = boxes.first(where: { $0.agents.contains { $0.id == selectedId } })?.id ?? boxes.first?.id
        initialized = true
    }
    private func select(_ runtime: RuntimeInstance) {
        if let session {
            if runtime.id == session.runtimeId { dismiss() }
            else if runtime.tier == .myComputers { pendingLocal = runtime }
            else { onMove(runtime); dismiss() }
        } else { store.selectRuntime(runtime); dismiss() }
    }
}

private struct SelectorBoxHeader: View {
    let box: SelectorBox
    let current: Bool
    let expanded: Bool
    let metricsUnavailable: Bool
    private var metrics: AgentDevice.Metrics? { metricsUnavailable ? nil : box.device?.liveMetrics }
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: box.isComputer ? "laptopcomputer" : box.id == "cloud" ? "cloud" : "shippingbox")
                .font(.system(size: 20)).frame(width: 28).foregroundStyle(Theme.body)
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text(box.label).font(.system(size: 16, weight: .semibold)).foregroundStyle(box.offline ? Theme.muted : Theme.heading).lineLimit(1)
                    if current { Text("Current").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.muted) }
                }
                HStack(spacing: 6) {
                    Circle().fill(box.offline ? Theme.muted : Color(hex: 0x127035)).frame(width: 6, height: 6)
                    Text(box.offline ? "Offline" : "Online · \(box.agents.count) \(box.agents.count == 1 ? "runtime" : "runtimes")")
                        .font(.system(size: 12)).foregroundStyle(Theme.muted)
                }
                if box.device != nil {
                    HStack(spacing: 12) {
                        SelectorMeter(title: "CPU", value: metrics.map(\.cpuPercent).flatMap { $0.isFinite && (0...100).contains($0) ? $0 : nil })
                        SelectorMeter(title: "MEM", value: metrics?.memory.percent)
                        SelectorMeter(title: "DISK", value: metrics?.disk.percent)
                    }
                    if expanded, let metrics, metrics.memory.percent != nil, metrics.disk.percent != nil {
                        Text("Memory \(metrics.memory.formatted) · Disk \(metrics.disk.formatted)")
                            .font(.system(size: 12)).monospacedDigit().foregroundStyle(Theme.muted)
                    }
                }
            }
            Spacer(minLength: 6)
            Image(systemName: expanded ? "chevron.down" : "chevron.right")
                .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.muted).padding(.top, 4)
        }
        .frame(minHeight: 48).contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(box.label + (current ? ", current computer" : "") + (box.offline ? ", offline" : ""))
    }
}

/// One resource: label, percent and a thin bar that turns amber at 80% and red at 95%.
private struct SelectorMeter: View {
    let title: String
    let value: Double?
    private var tint: Color {
        guard let value else { return Theme.muted }
        return value >= 95 ? Color(hex: 0xC22929) : value >= 80 ? Theme.warning : Color(hex: 0x745DF3)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 3) {
                Text(title).font(.system(size: 10, weight: .medium)).foregroundStyle(Theme.muted)
                Spacer(minLength: 1)
                Text(value.map { "\(Int($0.rounded()))%" } ?? "—").font(.system(size: 12, weight: .medium)).monospacedDigit()
                    .foregroundStyle(value.map { $0 >= 80 ? tint : Theme.body } ?? Theme.muted)
            }
            Capsule().fill(Theme.hairline).frame(height: 3).overlay(alignment: .leading) {
                if let value {
                    GeometryReader { proxy in Capsule().fill(tint).frame(width: proxy.size.width * value / 100) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title) usage")
        .accessibilityValue(value.map { "\(Int($0.rounded())) percent used" } ?? "Unavailable")
    }
}

private struct SelectorAgentRow: View {
    let runtime: RuntimeInstance
    let quota: RuntimeQuota?
    let selected: Bool
    let signedOut: Bool
    let canSignIn: Bool
    @ScaledMetric(relativeTo: .subheadline) private var titleSize = 16.0
    @ScaledMetric(relativeTo: .footnote) private var detailSize = 13.0
    var body: some View {
        HStack(spacing: 12) {
            BrandLogo(name: RuntimeInstance.Provider.logo(runtime.provider.rawValue), size: 20).frame(width: 28).foregroundStyle(Theme.heading)
            VStack(alignment: .leading, spacing: 5) {
                Text(SelectorBox.agentName(runtime)).font(.system(size: titleSize, weight: .medium)).foregroundStyle(Theme.heading).fixedSize(horizontal: false, vertical: true)
                if signedOut {
                    Text(canSignIn ? "Sign in required" : runtime.local.map { "Sign in on \($0.deviceLabel)" } ?? "Ask an administrator to sign in")
                        .font(.system(size: 12)).foregroundStyle(Theme.warning)
                } else {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 8) { details }
                        VStack(alignment: .leading, spacing: 2) { details }
                    }
                }
            }
            Spacer(minLength: 4)
            if signedOut {
                Text(canSignIn ? "Sign in" : "How to").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.heading)
                    .padding(.horizontal, 12).padding(.vertical, 8).background(Theme.canvas, in: Capsule())
            }
            if selected { Image(systemName: "checkmark").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.heading) }
        }.frame(minHeight: 48).contentShape(Rectangle())
    }
    @ViewBuilder private var details: some View {
        if SelectorBox.agentName(runtime) != runtime.providerName { Text(runtime.providerName).font(.system(size: detailSize)).foregroundStyle(Theme.muted) }
        if runtime.status == .disabled { Text("Unavailable").font(.footnote).foregroundStyle(Theme.muted) }
        else if let quota { QuotaLine(quota: quota) }
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
                Text(runtime.local.map { "Open Nuphos on \($0.deviceLabel), go to Settings → Agents, then choose Sign in for this runtime." } ?? "A workspace administrator can sign in to this runtime in Settings → Agents.")
                    .font(.subheadline).foregroundStyle(Theme.body).multilineTextAlignment(.center)
            }.frame(maxWidth: .infinity).padding(.vertical, 16).listRowBackground(Color.clear)
        }.scrollContentBackground(.hidden).background(Theme.canvas).navigationTitle("Sign in").navigationBarTitleDisplayMode(.inline)
    }
}

private struct SelectorManagementView: View {
    @Environment(AgentStore.self) private var store
    var body: some View {
        List {
            Section { Text("Open Settings → Agents in Nuphos Desktop to manage your computers and runtimes.").font(.subheadline).foregroundStyle(Theme.body) }
            ForEach(SelectorBox.grouped(store.runtimes, devices: store.agentDevices)) { box in
                Section(box.label) {
                    ForEach(box.agents) { runtime in
                        if let team = store.selectedTeam, runtime.tier == .cloud, team.isAdministrator {
                            NavigationLink(SelectorBox.agentName(runtime)) { AgentDetailView(team: team, runtime: runtime) }
                        } else if let team = store.selectedTeam, box.canSignIn(runtime, administrator: team.isAdministrator) {
                            NavigationLink(SelectorBox.agentName(runtime)) { AgentSetupView(team: team, runtime: runtime, selectOnCompletion: false) }
                        } else {
                            NavigationLink(SelectorBox.agentName(runtime)) { AgentSignInInstructions(runtime: runtime) }
                        }
                    }
                }.listRowBackground(Theme.surface)
            }
        }.scrollContentBackground(.hidden).background(Theme.canvas).navigationTitle("Computers and runtimes")
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
                                    .disabled(!config.isEditable || saving || (session != nil && (session?.ownsChat != true || error != nil)))
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
            HStack(spacing: 6) {
                QuotaGauge(window: window).frame(width: 44)
                Text([window.leftPercent == 0 ? "Limit reached" : "\(window.leftPercent)% left", reset(window.resetsAt)].compactMap(\.self).joined(separator: " · "))
                    .font(.system(size: 12))
                    .monospacedDigit()
                    .foregroundStyle(window.labelTint ?? Theme.muted)
            }
            .accessibilityElement(children: .combine)
        } else if quota.needsSignIn {
            Text("\(Image(systemName: "exclamationmark.circle.fill")) Sign in required")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.warning)
        }
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

/// A usage bar that starts full and drains like a battery.
struct QuotaGauge: View {
    let window: RuntimeQuota.Window

    var body: some View {
        Gauge(value: Double(window.leftPercent), in: 0...100) { EmptyView() }
            .gaugeStyle(.accessoryLinearCapacity)
            .tint(window.labelTint ?? Theme.heading)
            .scaleEffect(y: 0.8)
    }
}

extension RuntimeQuota.Window {
    /// Amber from 80% used and red once spent, as on Desktop. The label
    /// carries it too, since an empty bar has no fill left to colour.
    var labelTint: Color? {
        usedPercent >= 100 ? .red : usedPercent >= 80 ? Theme.warning : nil
    }
}
