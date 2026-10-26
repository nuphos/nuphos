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
    @State private var pendingLocal: RuntimeInstance?
    @State private var detent = PresentationDetent.height(720)

    private var selectedId: String? { session == nil ? store.newConversationRuntime?.id : session?.runtimeId }
    /// Only runtimes that can take a turn now: never an offline computer or one waiting for a sign-in.
    private var choices: [RuntimeInstance] {
        let ready = store.runtimes.filter { $0.isSelectable && $0.local?.online != false && store.quotas[$0.id]?.needsSignIn != true }
        guard let session, !session.isOwner else { return ready }
        return ready.filter { $0.kind == "managed" }
    }
    private var boxes: [SelectorBox] { SelectorBox.grouped(choices, devices: store.agentDevices) }
    private var administrator: Bool { store.selectedTeam?.isAdministrator == true }
    private var browsing: Bool { !showSetup && !managing && scenePhase == .active }

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
            .navigationDestination(isPresented: $managing) { RuntimesPage().navigationTitle("Runtimes") }
            .alert("Move to \(pendingLocal?.label ?? "")?", isPresented: Binding(get: { pendingLocal != nil }, set: { if !$0 { pendingLocal = nil } }), presenting: pendingLocal) { runtime in
                Button("Move") { onMove(runtime); dismiss() }
                Button("Cancel", role: .cancel) {}
            } message: { _ in
                Text("This runtime runs on your computer. After the move, anyone in this team can open this agent and run commands on your computer.")
            }
            .task(id: store.selectedTeam?.id) {
                initialized = false
                await store.loadRuntimes()
                openCurrentBox()
                await store.loadQuotas()
            }
            .task(id: "\(store.selectedTeam?.id ?? ""): \(browsing)") {
                guard browsing else { return }
                await store.pollAgentDevices()
            }
            .onChange(of: store.runtimes) { _, _ in openCurrentBox() }
        }
        .tint(Theme.heading)
        .presentationDetents([.height(720), .large], selection: $detent)
        .onChange(of: showSetup || managing) { _, open in if open { detent = .large } }
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
                                Button { select(runtime) } label: {
                                    SelectorAgentRow(runtime: runtime, quota: store.quotas[runtime.id], selected: runtime.id == selectedId)
                                        .padding(.leading, 12)
                                }
                                .buttonStyle(.plain)
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

struct SelectorBoxHeader: View {
    let box: SelectorBox
    let current: Bool
    let expanded: Bool
    let metricsUnavailable: Bool
    var showsChevron = true
    private var metrics: AgentDevice.Metrics? { metricsUnavailable ? nil : box.device?.liveMetrics }
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: box.isComputer ? "laptopcomputer" : box.id == "cloud" ? "cloud" : "shippingbox")
                .font(.system(size: 20)).frame(width: 28).foregroundStyle(Theme.body)
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text(box.label).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.heading).lineLimit(1)
                    if current { Text("Current").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.muted) }
                }
                Text("\(box.agents.count) \(box.agents.count == 1 ? "runtime" : "runtimes")")
                    .font(.system(size: 12)).foregroundStyle(Theme.muted)
                if let metrics {
                    HStack(spacing: 12) {
                        SelectorMeter(title: "CPU", value: metrics.cpuPercent)
                        SelectorMeter(title: "MEM", value: metrics.memory.percent)
                        SelectorMeter(title: "DISK", value: metrics.disk.percent)
                    }
                    if expanded {
                        Text("Memory \(metrics.memory.formatted) · Disk \(metrics.disk.formatted)")
                            .font(.system(size: 12)).monospacedDigit().foregroundStyle(Theme.muted)
                    }
                }
            }
            Spacer(minLength: 6)
            if showsChevron {
                Image(systemName: expanded ? "chevron.down" : "chevron.right")
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.muted).padding(.top, 4)
            }
        }
        .frame(minHeight: 48).contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(box.label + (current ? ", current computer" : ""))
    }
}

/// One resource: label, percent and a thin bar that turns amber at 80% and red at 95%.
private struct SelectorMeter: View {
    let title: String
    let value: Double
    private var tint: Color { value >= 95 ? Color(hex: 0xC22929) : value >= 80 ? Theme.warning : Color(hex: 0x745DF3) }
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 3) {
                Text(title).font(.system(size: 10, weight: .medium)).foregroundStyle(Theme.muted)
                Spacer(minLength: 1)
                Text("\(Int(value.rounded()))%").font(.system(size: 12, weight: .medium)).monospacedDigit()
                    .foregroundStyle(value >= 80 ? tint : Theme.body)
            }
            Capsule().fill(Theme.hairline).frame(height: 3).overlay(alignment: .leading) {
                GeometryReader { proxy in Capsule().fill(tint).frame(width: proxy.size.width * value / 100) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title) usage")
        .accessibilityValue("\(Int(value.rounded())) percent used")
    }
}

struct SelectorAgentRow: View {
    let runtime: RuntimeInstance
    let quota: RuntimeQuota?
    let selected: Bool
    @ScaledMetric(relativeTo: .subheadline) private var titleSize = 16.0
    @ScaledMetric(relativeTo: .footnote) private var detailSize = 13.0
    var body: some View {
        HStack(spacing: 12) {
            BrandLogo(name: RuntimeInstance.Provider.logo(runtime.provider.rawValue), size: 20).frame(width: 28).foregroundStyle(Theme.heading)
            VStack(alignment: .leading, spacing: 5) {
                Text(SelectorBox.agentName(runtime)).font(.system(size: titleSize, weight: .medium)).foregroundStyle(Theme.heading).fixedSize(horizontal: false, vertical: true)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { details }
                    VStack(alignment: .leading, spacing: 2) { details }
                }
            }
            Spacer(minLength: 4)
            if selected { Image(systemName: "checkmark").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.heading) }
        }.frame(minHeight: 48).contentShape(Rectangle())
    }
    @ViewBuilder private var details: some View {
        if SelectorBox.agentName(runtime) != runtime.providerName { Text(runtime.providerName).font(.system(size: detailSize)).foregroundStyle(Theme.muted) }
        if runtime.status != .active || runtime.local?.online == false {
            Text(runtime.status != .active ? "Disabled" : "Offline").font(.system(size: detailSize)).foregroundStyle(Theme.muted)
        }
        if let quota { QuotaLine(quota: quota) }
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
