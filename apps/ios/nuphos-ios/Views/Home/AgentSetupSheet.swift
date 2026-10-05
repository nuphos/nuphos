import SwiftUI

struct AgentSetupSheet: View {
    @Environment(AuthSession.self) private var auth
    @Environment(AgentStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    let team: Team
    @State private var provider = "codex"
    @State private var label = "My agent"
    @State private var runtime: RuntimeInstance?
    @State private var login: WorkspaceAPI.Login?
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?

    init(team: Team, runtime: RuntimeInstance? = nil) {
        self.team = team
        _runtime = State(initialValue: runtime)
    }

    var body: some View {
        NavigationStack {
            Form {
                if let runtime {
                    Section(runtime.label) {
                        Text(runtime.providerName)
                        if let login {
                            if login.state == "connected" {
                                Label("Connected", systemImage: "checkmark.circle.fill")
                                Button("Use this agent") { finish(runtime) }
                            } else if login.pending {
                                Text(runtime.provider == .grok ? "Finish signing in with your xAI account, then return here." : "Finish signing in with your AI provider, then return here.")
                                if let userCode = login.userCode {
                                    LabeledContent("Verification code", value: userCode).textSelection(.enabled)
                                }
                                if let url = login.url { Button("Open sign-in page") { openURL(url) } }
                                if login.authorizationUrl != nil, login.codeSubmitted != true {
                                    TextField(runtime.provider == .antigravity ? "Paste the full address starting with http://127.0.0.1" : "Paste the full authorization code", text: $code).textInputAutocapitalization(.never).autocorrectionDisabled()
                                    Button("Submit code") { submitCode() }.disabled(code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                                }
                                ProgressView(login.state == "starting" ? "Preparing sign-in…" : "Waiting for authorization…")
                            } else {
                                Text(login.error ?? "Sign-in ended. Please try again.")
                                Button("Try sign-in again") { startLogin(runtime) }
                            }
                        } else {
                            Text("Connect your own AI provider account to use this agent.")
                            Button("Sign in to \(runtime.providerName)") { startLogin(runtime) }
                        }
                    }
                } else {
                    Section("Cloud agent") {
                        TextField("Agent name", text: $label)
                        Picker("Provider", selection: $provider) {
                            Text("OpenAI / ChatGPT").tag("codex")
                            Text("Anthropic / Claude").tag("claude-code")
                            Text("xAI / Grok").tag("grok")
                            Text("Google / Antigravity").tag("antigravity")
                        }
                        Text("You will sign in to your provider on its own website. Your provider's usage limits apply.")
                        Button("Create agent") { create() }
                            .disabled(label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || label.count > 80)
                    }
                }
                if let error { Text(error).foregroundStyle(.red) }
                if busy { ProgressView() }
            }
            .disabled(busy)
            .navigationTitle("Set up agent")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(busy) } }
            .task(id: login?.attemptId) {
                guard let runtime, let token = auth.token, login?.pending == true else { return }
                while !Task.isCancelled, login?.pending == true {
                    do {
                        try await Task.sleep(for: .seconds(3))
                        let value: WorkspaceAPI.Login = try await WorkspaceAPI.request(path(runtime) + "/login", token: token)
                        guard !Task.isCancelled else { return }
                        login = value
                        error = nil
                    } catch is CancellationError { return }
                    catch { self.error = error.localizedDescription }
                }
            }
        }
        .interactiveDismissDisabled(busy)
    }

    private func path(_ runtime: RuntimeInstance) -> String { "teams/\(team.id)/agent-runtimes/\(runtime.id)" }
    private func create() {
        guard let token = auth.token else { return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                let created: RuntimeInstance = try await WorkspaceAPI.request("teams/\(team.id)/agent-runtimes", token: token, method: "POST", body: .object(["provider": .string(provider), "label": .string(label.trimmingCharacters(in: .whitespacesAndNewlines))]))
                runtime = created
                await store.loadRuntimes(force: true)
            } catch { self.error = error.localizedDescription }
        }
    }
    private func startLogin(_ runtime: RuntimeInstance) {
        guard let token = auth.token else { return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do { login = try await WorkspaceAPI.request(path(runtime) + "/login", token: token, method: "POST") }
            catch { self.error = error.localizedDescription }
        }
    }
    private func submitCode() {
        guard let token = auth.token, let runtime, let login else { return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                self.login = try await WorkspaceAPI.request(path(runtime) + "/login/code", token: token, method: "POST", body: .object(["attemptId": .string(login.attemptId), "code": .string(code.trimmingCharacters(in: .whitespacesAndNewlines))]))
                code = ""
            } catch { self.error = error.localizedDescription }
        }
    }
    private func finish(_ runtime: RuntimeInstance) {
        Task { await store.loadRuntimes(force: true); store.selectRuntime(runtime); dismiss() }
    }
}
