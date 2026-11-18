import SwiftUI

/// Desktop's Add computer → Box step (`BoxAgentStep.tsx`): makes a Box, waits for its
/// runtimes to join the team, then hands the chosen one to sign-in.
struct NewBoxView: View {
    @Environment(AgentStore.self) private var store
    @State private var name = ""
    @State private var creating = false
    /// The Box this screen made, and when, for Desktop's five-minute timeout.
    @State private var made: (deviceId: String, at: Date)?
    /// Written by the polling loop, so the timeout shows even when the lists stay the same.
    @State private var now = Date()
    @State private var failure: Failure?

    struct Failure {
        /// The plan refused it (`402 box_vcpu_limit`), Desktop's paywall.
        let plan: Bool
        /// The server's own sentence.
        let message: String
    }

    enum Phase { case idle, starting, ready, error, timeout }

    /// Desktop's `nextBoxName`: "Computer N", after the highest the viewer has.
    private var placeholder: String {
        let taken = store.agentDevices.compactMap { device in
            device.label.wholeMatch(of: /Computer (\d+)/).flatMap { Int($0.1) }
        }
        return "Computer \((taken.max() ?? 0) + 1)"
    }

    private var agents: [RuntimeInstance] {
        guard let made else { return [] }
        return store.runtimes.filter { $0.local?.deviceId == made.deviceId }
    }

    /// Desktop's `boxSetupPhase`: up once the team lists one of its runtimes. A Box not
    /// listed yet is starting, as Desktop's unloaded list is: a failed read keeps the old one.
    private var phase: Phase {
        guard let made else { return .idle }
        if !agents.isEmpty { return .ready }
        if store.agentDevices.first(where: { $0.deviceId == made.deviceId })?.box?.state == "error" { return .error }
        return now.timeIntervalSince(made.at) > 5 * 60 ? .timeout : .starting
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                switch phase {
                case .idle: form
                case .starting:
                    HStack(spacing: 12) {
                        ProgressView().tint(Theme.muted)
                        Text("Starting the computer and its runtimes, usually 10 to 30 seconds…")
                    }.font(.callout).foregroundStyle(Theme.body)
                case .ready: runtimes
                case .error:
                    Text("The computer could not start. Delete it on the Runtimes page and try again.")
                        .font(.callout).foregroundStyle(Theme.attention)
                case .timeout:
                    Text("The computer has not started after 5 minutes. Delete it on the Runtimes page and try again.")
                        .font(.callout).foregroundStyle(Theme.attention)
                }
            }.padding(24).frame(maxWidth: 560).frame(maxWidth: .infinity)
        }
        .background(Theme.canvas)
        .navigationTitle("Nuphos computer")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(creating)
        .alert(
            failure?.plan == true ? "Choose a computer plan" : "Could not create computer",
            isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } }),
            presenting: failure
        ) { _ in
            Button("Not now", role: .cancel) {}
        } message: { failure in
            Text(failure.plan ? "\(failure.message)\n\n\(String(localized: "Choose a plan in Nuphos on your computer."))" : failure.message)
        }
        // Desktop polls the new Box every second until its runtimes join.
        .task(id: made?.deviceId) {
            while made != nil, phase == .starting, !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                async let devices: Void = store.loadAgentDevices()
                async let runtimes: Void = store.loadRuntimes(force: true)
                _ = await (devices, runtimes)
                now = Date()
            }
        }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("A Linux computer with Claude Code and Codex on it. Running computers count against your plan's vCPU; paused ones do not.")
                .font(.callout).foregroundStyle(Theme.body)
            VStack(alignment: .leading, spacing: 12) {
                Text("Name").font(.footnote.weight(.medium)).foregroundStyle(Theme.body)
                TextField(placeholder, text: $name)
                    .font(.callout).padding(14).background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                    .accessibilityLabel("Name")
                    .disabled(creating)
                Text("Leave it empty to call it \(placeholder).").font(.footnote).foregroundStyle(Theme.muted)
            }
            Button { Task { await create() } } label: {
                Text(creating ? "Creating…" : "Create computer").frame(maxWidth: .infinity)
            }
            .prominentButton()
            .disabled(creating)
        }
    }

    private var runtimes: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Your computer is running. Choose a runtime to sign in.").font(.callout).foregroundStyle(Theme.body)
            if let team = store.selectedTeam {
                VStack(spacing: 4) {
                    ForEach(agents) { runtime in
                        NavigationLink {
                            AgentSetupView(team: team, runtime: runtime, selectOnCompletion: false)
                        } label: {
                            // Desktop's runtime choices: its logo and name, signed in from here.
                            HStack(spacing: 12) {
                                BrandLogo(name: RuntimeInstance.Provider.logo(runtime.provider.rawValue), size: 20).frame(width: 28)
                                Text(SelectorBox.agentName(runtime)).font(.callout.weight(.medium)).foregroundStyle(Theme.heading)
                                Spacer(minLength: 0)
                                LucideIcon("chevron-right").foregroundStyle(Theme.muted)
                            }
                            .padding(12).frame(minHeight: 48).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }.background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
            }
        }
    }

    /// The same request as Desktop's: the name shown as the default is the one sent.
    private func create() async {
        guard let team = store.selectedTeam, !creating else { return }
        struct Request: Encodable { let label: String; let teamId: String }
        struct Made: Decodable { let deviceId: String }
        let label = name.trimmingCharacters(in: .whitespacesAndNewlines)
        creating = true
        defer { creating = false }
        do {
            // As long as the proxy waits: the backend waits for instabox to accept the order.
            let data = try await AgentChatAPI.send(
                "POST", "agent/devices/boxes", token: store.token,
                body: Request(label: label.isEmpty ? placeholder : label, teamId: team.id), timeout: 60)
            let box = try JSONDecoder().decode(Made.self, from: data)
            made = (box.deviceId, Date())
        } catch AgentChatAPI.Conflict.other(code: "box_vcpu_limit", let message, _) {
            failure = Failure(plan: true, message: message)
        } catch {
            failure = Failure(plan: false, message: error.localizedDescription)
        }
    }
}
