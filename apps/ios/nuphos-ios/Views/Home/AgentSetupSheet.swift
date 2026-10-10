import SwiftUI

/// "Set up agent" as its own sheet, for screens without a navigation stack.
struct AgentSetupSheet: View {
    @Environment(\.dismiss) private var dismiss
    let team: Team
    var runtime: RuntimeInstance?
    var login: WorkspaceAPI.Login?

    var body: some View {
        NavigationStack {
            AgentSetupView(team: team, runtime: runtime, login: login)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

/// Creates a Cloud agent and signs it in to the user's own provider account,
/// or, given `runtime`, signs an existing one in again.
struct AgentSetupView: View {
    @Environment(AuthSession.self) private var auth
    @Environment(AgentStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    let team: Team
    @State private var provider = RuntimeInstance.Provider.claudeCode
    @State private var name = ""
    @State private var runtime: RuntimeInstance?
    @State private var login: WorkspaceAPI.Login?
    @State private var code = ""
    @State private var search = ""
    @State private var busy = false
    /// A just-created agent is still starting; sign-in needs it to answer first.
    @State private var agentStarting = false
    @State private var copied = false
    @State private var error: String?

    init(team: Team, runtime: RuntimeInstance? = nil, login: WorkspaceAPI.Login? = nil) {
        self.team = team
        _runtime = State(initialValue: runtime)
        _login = State(initialValue: login)
    }

    private static let providers: [(RuntimeInstance.Provider, vendor: String)] = [
        (.claudeCode, "Anthropic"), (.codex, "OpenAI"), (.grok, "xAI"), (.antigravity, "Google"), (.opencode, "OpenCode"),
    ]

    private var connected: Bool { login?.state == "connected" }
    private var needsCode: Bool { login?.needsAnswer == true && login?.step?.kind != "choose" }
    private var trimmedCode: String { code.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        Form {
            if let runtime { signIn(runtime) } else { createForm }
            if let error {
                Section { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).font(.footnote) }
            }
        }
        .navigationTitle(runtime?.label ?? "New Agent")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if busy {
                    ProgressView()
                } else if runtime == nil {
                    Button("Create") { create(provider) }.buttonStyle(.glassProminent)
                } else if needsCode {
                    Button("Continue") { submitCode() }.buttonStyle(.glassProminent).disabled(trimmedCode.isEmpty)
                } else if connected, let runtime {
                    Button("Done") { finish(runtime) }.buttonStyle(.glassProminent)
                }
            }
        }
        .interactiveDismissDisabled(busy || login?.pending == true)
        .task(id: login?.attemptId) {
            guard let runtime, let token = auth.token, login?.pending == true else { return }
            while !Task.isCancelled, login?.pending == true {
                do {
                    try await Task.sleep(for: .seconds(3))
                    let value: WorkspaceAPI.Login = try await WorkspaceAPI.request(path(runtime) + "/login", token: token)
                    guard !Task.isCancelled else { return }
                    login = value
                } catch is CancellationError { return }
                catch {}
            }
        }
    }

    // MARK: - Create

    @ViewBuilder
    private var createForm: some View {
        Section {
            ForEach(Self.providers, id: \.0) { entry in
                let item = entry.0
                Button { provider = item } label: {
                    HStack(spacing: 12) {
                        ProviderIcon(provider: item, size: 30)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(RuntimeInstance.Provider.name(item.rawValue)).foregroundStyle(Theme.heading)
                            Text(entry.vendor).font(.footnote).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if item == provider {
                            Image(systemName: "checkmark").fontWeight(.semibold).foregroundStyle(Theme.heading)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        } header: {
            Text("Provider")
        }

        Section {
            LabeledContent("Name") {
                TextField("Name", text: $name, prompt: Text(RuntimeInstance.Provider.name(provider.rawValue)))
                    .multilineTextAlignment(.trailing)
                    .submitLabel(.done)
                    .onChange(of: name) { _, value in if value.count > 80 { name = String(value.prefix(80)) } }
            }
        } footer: {
            Text("You'll sign in with your own \(account(provider)) account. Your plan's usage limits apply.")
        }
    }

    // MARK: - Sign in

    @ViewBuilder
    private func signIn(_ runtime: RuntimeInstance) -> some View {
        Section {
            VStack(spacing: 12) {
                ZStack(alignment: .bottomTrailing) {
                    ProviderIcon(provider: runtime.provider, size: 64)
                    if connected {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(.white, .green)
                            .background(Circle().fill(Theme.canvas).padding(-2))
                            .offset(x: 6, y: 6)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
                Text(connected ? "Connected" : "Sign in to \(runtime.providerName)")
                    .font(.title3.weight(.semibold))
                Text(headline(runtime))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .listRowBackground(Color.clear)
            .animation(.snappy, value: connected)
        }

        if agentStarting {
            Section { HStack { Spacer(); ProgressView("Starting your agent…"); Spacer() } }
        } else if let login, login.pending {
            if login.state == "starting" {
                Section { HStack { Spacer(); ProgressView("Preparing sign-in…"); Spacer() } }
            } else if let step = login.step {
                stepSections(step, login: login)
            } else {
                // Device sign-in: the code comes first, since the page asks for it.
                if let userCode = login.userCode {
                    Section {
                        HStack {
                            Text(userCode).font(.title2.monospaced().weight(.semibold)).textSelection(.enabled)
                            Spacer()
                            Button(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc") {
                                UIPasteboard.general.string = userCode
                                copied = true
                            }
                            .labelStyle(.iconOnly)
                            .contentTransition(.symbolEffect(.replace))
                        }
                    } header: {
                        Text("Verification Code")
                    } footer: {
                        Text("1. Copy this code.\n2. Open the sign-in page and sign in with your \(vendor(runtime.provider)) account.\n3. Enter the code when asked. This page updates once you're signed in.")
                    }
                }
                if let url = login.url {
                    Section {
                        Button { openURL(url) } label: {
                            Text("Open Sign-In Page").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }
                }
                if needsCode {
                    Section {
                        HStack {
                            TextField(runtime.provider == .antigravity ? "http://127.0.0.1…" : "Authorization code", text: $code)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .submitLabel(.continue)
                                .onSubmit { if !trimmedCode.isEmpty { submitCode() } }
                            PasteButton(payloadType: String.self) { values in
                                guard let value = values.first else { return }
                                Task { @MainActor in code = value; submitCode() }
                            }
                            .labelStyle(.iconOnly)
                            .buttonBorderShape(.circle)
                        }
                    } header: {
                        Text(runtime.provider == .antigravity ? "Redirect Address" : "Authorization Code")
                    } footer: {
                        Text(runtime.provider == .antigravity
                            ? "After signing in, your browser opens a page that won't load. Copy its full address and paste it here."
                            : "After signing in, copy the code shown on the page and paste it here.")
                    }
                } else {
                    Section { HStack { Spacer(); ProgressView("Waiting for \(runtime.providerName)…"); Spacer() } }
                }
            }
        } else if !connected {
            Section {
                Button { startLogin(runtime) } label: {
                    Text(login == nil ? "Sign In" : "Try Again").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(busy)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
        }
    }

    /// A step of a sign-in that asks before it authorizes, as OpenCode's does.
    @ViewBuilder
    private func stepSections(_ step: WorkspaceAPI.Login.Step, login: WorkspaceAPI.Login) -> some View {
        if login.codeSubmitted == true {
            Section { HStack { Spacer(); ProgressView("Continuing sign-in…"); Spacer() } }
        } else if step.kind == "choose" {
            let options = (step.options ?? []).filter {
                search.isEmpty || $0.label.localizedCaseInsensitiveContains(search) || $0.value.localizedCaseInsensitiveContains(search)
            }
            Section {
                if (step.options?.count ?? 0) > 8 {
                    TextField("Search", text: $search)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                ForEach(options) { option in
                    Button {
                        code = option.value
                        search = ""
                        submitCode()
                    } label: {
                        HStack {
                            Text(option.label).foregroundStyle(Theme.heading)
                            Spacer()
                            if let hint = option.hint { Text(hint).font(.footnote).foregroundStyle(.secondary) }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(busy)
                }
            } header: {
                Text(step.message ?? "Choose")
            }
        } else if step.kind == "input" {
            Section {
                Group {
                    if step.secret == true {
                        SecureField(step.placeholder ?? "", text: $code)
                    } else {
                        TextField(step.placeholder ?? "", text: $code)
                    }
                }
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.continue)
                .onSubmit { if !trimmedCode.isEmpty { submitCode() } }
            } header: {
                Text(step.message ?? "")
            } footer: {
                if step.secret == true { Text("Nuphos encrypts it on its way to the agent, which keeps it; Nuphos does not keep a copy.") }
            }
        } else {
            if let instructions = step.instructions, !instructions.isEmpty {
                Section { Text(instructions).textSelection(.enabled) }
            }
            if let url = login.url {
                Section {
                    Button { openURL(url) } label: {
                        Text("Open \(url.host() ?? "Sign-In Page")").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }
            }
            if let paste = step.paste {
                Section {
                    TextField(paste == "address" ? "http://localhost…" : "Authorization code", text: $code)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.continue)
                        .onSubmit { if !trimmedCode.isEmpty { submitCode() } }
                } header: {
                    Text(paste == "address" ? "Redirect Address" : "Authorization Code")
                } footer: {
                    Text(paste == "address"
                        ? "After signing in, your browser opens a page that won't load. Copy its full address and paste it here."
                        : "After signing in, copy the code shown on the page and paste it here.")
                }
            } else {
                Section { HStack { Spacer(); ProgressView("Waiting for approval…"); Spacer() } }
            }
        }
    }

    /// Whose account the sign-in uses; OpenCode signs in to whichever model provider you pick.
    private func account(_ provider: RuntimeInstance.Provider) -> String {
        provider == .opencode ? "model provider" : vendor(provider)
    }

    private func vendor(_ provider: RuntimeInstance.Provider) -> String {
        Self.providers.first { $0.0 == provider }?.vendor ?? RuntimeInstance.Provider.name(provider.rawValue)
    }

    private func headline(_ runtime: RuntimeInstance) -> String {
        if agentStarting { return "A new agent takes a moment to start." }
        guard let login else { return "Use your own \(account(runtime.provider)) account. Your plan's usage limits apply." }
        switch login.state {
        case "connected": return "\(runtime.label) is ready to use."
        case "starting", "awaiting_authorization":
            if login.step != nil, login.url == nil { return "Choose how to sign in, then follow the steps." }
            return login.url == nil ? "Getting your sign-in page ready." : "Sign in with your \(account(runtime.provider)) account, then come back here."
        default: return login.error ?? "Sign-in didn't finish."
        }
    }

    // MARK: - Actions

    private func path(_ runtime: RuntimeInstance) -> String { "teams/\(team.id)/agent-runtimes/\(runtime.id)" }

    private func create(_ provider: RuntimeInstance.Provider) {
        guard let token = auth.token else { return }
        let label = name.trimmingCharacters(in: .whitespacesAndNewlines)
        busy = true; error = nil
        Task {
            do {
                let created: RuntimeInstance = try await WorkspaceAPI.request("teams/\(team.id)/agent-runtimes", token: token, method: "POST", body: .object(["provider": .string(provider.rawValue), "label": .string(label.isEmpty ? RuntimeInstance.Provider.name(provider.rawValue) : label)]))
                withAnimation { runtime = created }
                busy = false
                startLogin(created)
                await store.loadRuntimes(force: true)
            } catch { self.error = error.localizedDescription; busy = false }
        }
    }

    private func startLogin(_ runtime: RuntimeInstance) {
        guard let token = auth.token else { return }
        struct Status: Decodable { let online: Bool }
        busy = true; error = nil
        Task {
            defer { busy = false; agentStarting = false }
            do {
                // Like Desktop: wait (up to ~3 minutes) until the agent answers, then sign in.
                for _ in 0..<90 {
                    let status: Status? = try? await WorkspaceAPI.request(path(runtime) + "/status", token: token)
                    if status?.online == true { break }
                    agentStarting = true
                    try await Task.sleep(for: .seconds(2))
                }
                login = try await WorkspaceAPI.request(path(runtime) + "/login", token: token, method: "POST")
            } catch { self.error = error.localizedDescription }
        }
    }

    private func submitCode() {
        guard let token = auth.token, let runtime, let login, !trimmedCode.isEmpty else { return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                self.login = try await WorkspaceAPI.request(path(runtime) + "/login/code", token: token, method: "POST", body: .object(["attemptId": .string(login.attemptId), "code": .string(trimmedCode)]))
                code = ""
            } catch { self.error = error.localizedDescription }
        }
    }

    private func finish(_ runtime: RuntimeInstance) {
        Task {
            async let runtimes: Void = store.loadRuntimes(force: true)
            async let quotas: Void = store.loadQuotas()
            _ = await (runtimes, quotas)
            store.selectRuntime(runtime)
            dismiss()
        }
    }
}

/// A provider's mark on a rounded tile, like an app icon in Settings.
struct ProviderIcon: View {
    let provider: RuntimeInstance.Provider
    var size: CGFloat = 30

    var body: some View {
        BrandLogo(name: RuntimeInstance.Provider.logo(provider.rawValue), size: size * 0.58)
            .foregroundStyle(Theme.heading)
            .frame(width: size, height: size)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: size * 0.225, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: size * 0.225, style: .continuous).strokeBorder(Theme.hairline))
    }
}
