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
    @State private var failure: NewBox.Failure?

    private var placeholder: String { NewBox.defaultName(after: store.agentDevices.map(\.label)) }

    private var agents: [RuntimeInstance] {
        guard let made else { return [] }
        return store.runtimes.filter { $0.local?.deviceId == made.deviceId }
    }

    private var phase: NewBox.Phase {
        NewBox.phase(
            madeAt: made?.at, now: now,
            state: store.agentDevices.first { $0.deviceId == made?.deviceId }?.box?.state, runtimes: agents.count)
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
        .navigationTitle("Rent a computer from Nuphos")
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
        // Desktop polls the new Box every second while its runtimes join.
        .task(id: made?.deviceId) {
            while made != nil, phase.reads, !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                async let devices: Void = store.loadAgentDevices()
                async let runtimes: Void = store.loadRuntimes()
                _ = await (devices, runtimes)
                now = Date()
            }
        }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("A Linux computer Nuphos runs, with Claude Code, Codex, OpenCode and more on it. Running computers count against your plan's vCPU; paused ones do not.")
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

    private func create() async {
        guard let team = store.selectedTeam, !creating else { return }
        struct Made: Decodable { let deviceId: String }
        creating = true
        defer { creating = false }
        do {
            // As long as the proxy waits: the backend waits for instabox to accept the order.
            let data = try await AgentChatAPI.send(
                "POST", NewBox.path, token: store.token,
                body: NewBox.request(typed: name, labels: store.agentDevices.map(\.label), teamId: team.id), timeout: 60)
            let box = try JSONDecoder().decode(Made.self, from: data)
            made = (box.deviceId, Date())
        } catch AgentChatAPI.Conflict.other(let code, let message, _) {
            failure = NewBox.Failure(code: code, message: message)
        } catch {
            failure = NewBox.Failure(code: nil, message: error.localizedDescription)
        }
    }
}
