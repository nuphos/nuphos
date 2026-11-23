#if DEBUG && os(iOS)
import SwiftUI

/// Local preview of account setup and the next onboarding step.
struct MobileOnboardingPreview: View {
    private enum Step: Hashable {
        case consent, workspace, computer, ownComputer, runtimes, model, modelConnection, nextStage
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var session = AuthSession()
    @State private var onboarding = false
    @State private var showingLogin = false
    @State private var showingServer = false
    @State private var showingCloudPlan = false
    @State private var openLoginAfterServerSave = false
    @State private var path: [Step] = []
    @State private var store: AgentStore?
    @State private var rootStep: Step?
    @State private var showedConsent = false
    @State private var waitingForComputerPreview = false
    @State private var existingBot = false
    /// The Cloud tour ended. Its consent was only simulated, so this goes home without asking again.
    @State private var tourFinished = false
    @State private var setupError: String?
    @State private var setupAttempt = 0
    @State private var runtimeRefreshing = false
    @State private var computerChecked = false
    @State private var workspaceDraft: String?
    @State private var savingWorkspace = false
    @State private var workspaceError: String?
    @State private var runtimeError: String?
    @State private var cloudAvailable = false
    @State private var boxUsage: BoxUsage?
    @State private var cloudBox: AgentDevice?
    @State private var creatingBox = false
    @State private var boxError: String?
    @State private var upgradeRequired = false
    @State private var runtimes: [RuntimeInstance] = []

    private var selfHosted: Bool { NuphosAPI.baseURL(for: session.token) != NuphosAPI.defaultBaseURL }

    var body: some View {
        ZStack {
            if onboarding, let user = session.user {
                if waitingForComputerPreview {
                    computerWaitingPreview
                } else if tourFinished {
                    HomeView(user: user).id(session.generation)
                } else if !session.aiConsentAccepted {
                    NavigationStack {
                        AIConsentView(user: user, embedded: true)
                            .onAppear { showedConsent = true }
                            .toolbar {
                                ToolbarItem(placement: .topBarTrailing) { moreMenu }
                            }
                    }
                } else if existingBot {
                    HomeView(user: user).id(session.generation)
                } else if let rootStep, let store {
                    flow(rootStep).environment(store)
                } else {
                    setupStatus
                }
            } else {
                OnboardingWelcome(signIn: signInToCloud, useOwnServer: editServer)
                    .transition(.opacity)
            }
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.35), value: onboarding)
        .environment(session)
        .task { await session.restore() }
        .sheet(isPresented: $showingLogin, onDismiss: {
            if session.addingAccount { Task { await session.cancelAddAccount() } }
        }) {
            LoginView(
                onClose: { showingLogin = false },
                onContinueWithActiveAccount: completeLogin
            )
                .environment(session)
                .id(session.generation)
        }
        .sheet(isPresented: $showingCloudPlan) {
            cloudPlanSheet
        }
        .sheet(isPresented: $showingServer, onDismiss: {
            if openLoginAfterServerSave {
                openLoginAfterServerSave = false
                signIn()
            }
        }) {
            LoginServerSettings(onSave: {
                openLoginAfterServerSave = true
                showingServer = false
            })
        }
        .onChange(of: session.aiConsentAccepted) { _, accepted in
            if !accepted {
                path = []
                rootStep = nil
                existingBot = false
            }
        }
        .onChange(of: session.state) { _, state in
            if case .signedIn = state, showingLogin { completeLogin() }
        }
    }

    private var computerWaitingPreview: some View {
        // Its last step, or skipping the computer, opens the app's home.
        CloudOnboardingTour(more: { moreMenu }, onFinish: {
            tourFinished = true
            waitingForComputerPreview = false
        }, session: session)
    }

    // MARK: Flow after sign-in

    private var setupStatus: some View {
        NavigationStack {
            VStack(spacing: 16) {
                if let setupError {
                    Text(setupError).foregroundStyle(Theme.body)
                    primary("Try again") { setupAttempt += 1 }
                } else {
                    ProgressView("Checking your account…")
                }
            }
            .padding(24)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { moreMenu } }
        }
        .task(id: setupAttempt) {
            guard session.aiConsentAccepted, let token = session.token else { return }
            setupError = nil
            do {
                let teams = try await NuphosAPI.teams(token: token)
                for team in teams {
                    let bots = try await NuphosAPI.conversations(
                        token: token, teamId: team.id, limit: 1, bots: true, includeOnboarding: true
                    )
                    if !bots.rows.isEmpty {
                        try Task.checkCancellation()
                        existingBot = true
                        return
                    }
                }
                if !selfHosted && (teams.isEmpty || teams.contains(where: { $0.isOwner != false })) {
                    try Task.checkCancellation()
                    waitingForComputerPreview = true
                    return
                }
                let accountStore = AgentStore(token: token, loadsHistory: false)
                await accountStore.loadTeams()
                try Task.checkCancellation()
                if case .failed(let message) = accountStore.teamsPhase {
                    setupError = message
                    return
                }
                store = accountStore
                let steps = initialSetupSteps
                rootStep = steps.first
                path = Array(steps.dropFirst())
            } catch is CancellationError {
                return
            } catch {
                setupError = error.localizedDescription
            }
        }
    }

    private var initialSetupSteps: [Step] {
        let steps: [Step]
        if let team = store?.selectedTeam {
            steps = team.isOwner == false ? [.nextStage] : [.workspace, .computer]
        } else {
            steps = [.workspace]
        }
        return showedConsent ? [.consent] + steps : steps
    }

    private func flow(_ root: Step) -> some View {
        NavigationStack(path: $path) {
            screen(root).navigationDestination(for: Step.self) { screen($0) }
        }
        .tint(Theme.heading)
    }

    private func screen(_ step: Step) -> some View {
        Group {
            switch step {
            case .consent:
                if let user = session.user {
                    AIConsentView(user: user, embedded: true, onContinue: {
                        path.append(store?.selectedTeam?.isOwner == false ? .nextStage : .workspace)
                    })
                }
            case .workspace:
                WorkspaceSetupSheet(onComplete: { team in
                    workspaceDraft = nil
                    resetComputer()
                    path.append(team.isOwner == false ? .nextStage : .computer)
                }, onDraft: { name in
                    workspaceDraft = name
                    resetComputer()
                    path.append(.computer)
                }, draftName: workspaceDraft)
            case .runtimes:
                RuntimesPage().navigationTitle("Runtimes")
            default:
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        content(step)
                    }
                    .frame(maxWidth: 480, alignment: .leading)
                    .padding(24)
                    .frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .task(id: step) {
            guard workspaceDraft == nil else { return }
            if step == .computer || step == .ownComputer {
                await refreshOwnComputer()
            } else if step == .model {
                await refreshRuntimes()
            }
        }
        .background(Theme.canvas)
        .foregroundStyle(Theme.heading)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if step == rootStep {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: returnToWelcome) { LucideIcon("chevron-left") }
                        .accessibilityLabel("Back")
                }
            }
            ToolbarItem(placement: .topBarTrailing) { moreMenu }
        }
    }

    private func refreshRuntimes(checkCloud: Bool = false) async {
        guard let token = session.token, let teamID = store?.selectedTeam?.id else { return }
        runtimeRefreshing = true
        runtimeError = nil
        defer {
            runtimeRefreshing = false
            if checkCloud && !Task.isCancelled { computerChecked = true }
        }
        do {
            let result = try await NuphosAPI.runtimeInstances(token: token, teamId: teamID)
            guard !Task.isCancelled else { return }
            runtimes = result.filter { $0.status == .active && $0.local?.online != false }
            if checkCloud && !selfHosted {
                let devices: CloudDevices = try await WorkspaceAPI.request(
                    "agent/devices", query: [URLQueryItem(name: "teamId", value: teamID)], token: token
                )
                try Task.checkCancellation()
                cloudAvailable = devices.boxAvailable == true && devices.canCreateBox == true
                cloudBox = devices.devices.first { $0.box != nil && $0.access == "manage" }
                let usage: BoxUsage = try await WorkspaceAPI.request("teams/\(teamID)/box-usage", token: token)
                try Task.checkCancellation()
                boxUsage = usage
            }
        } catch is CancellationError {
            return
        } catch {
            runtimeError = error.localizedDescription
        }
    }

    private func refreshOwnComputer() async {
        async let devices: Void? = store?.loadAgentDevices()
        await refreshRuntimes()
        _ = await devices
    }

    private var personalDevices: [AgentDevice] {
        guard workspaceDraft == nil else { return [] }
        return store?.agentDevices.filter { $0.box == nil && $0.access == "manage" } ?? []
    }

    private var personalRuntimes: [RuntimeInstance] {
        let ids = Set(personalDevices.map(\.deviceId))
        return runtimes.filter { runtime in
            runtime.local.map { ids.contains($0.deviceId) } ?? false
        }
    }

    private var ownComputerDetail: String {
        guard !personalDevices.isEmpty else {
            return String(localized: "Connect a Mac, PC, or server in Nuphos Desktop.")
        }
        let count = personalDevices.count
        if personalRuntimes.contains(where: { $0.provider == .opencode && $0.isSelectable }) {
            return String(localized: "Computers found: \(count). OpenCode is available.")
        }
        let subscriptions = personalRuntimes.filter { $0.provider == .codex || $0.provider == .claudeCode }
        if subscriptions.contains(where: { $0.local?.signedIn == true }) {
            return String(localized: "Computers found: \(count). A model is signed in.")
        }
        if !subscriptions.isEmpty && subscriptions.allSatisfy({ $0.local?.signedIn == false }) {
            return String(localized: "Computers found: \(count). Sign in to a model or use OpenCode.")
        }
        return String(localized: "Computers found: \(count). Check runtime and model setup.")
    }

    private struct BoxUsage: Decodable {
        let subscribed: Bool
        let limitVcpus: Int?
        let usedVcpus: Int?
        let boxVcpus: Int?

        var canCreate: Bool {
            guard subscribed else { return false }
            guard let limitVcpus else { return true }
            guard let usedVcpus, let boxVcpus else { return false }
            return limitVcpus - usedVcpus >= boxVcpus
        }
    }

    private var hasCloudRuntime: Bool {
        runtimes.contains { runtime in
            runtime.tier == .cloud || (cloudBox != nil && runtime.local?.deviceId == cloudBox?.deviceId)
        }
    }

    private struct CloudDevices: Decodable {
        let boxAvailable: Bool?
        let canCreateBox: Bool?
        let devices: [AgentDevice]
    }

    private func createCloudBox() async {
        guard !creatingBox, let token = session.token, let team = store?.selectedTeam else { return }
        creatingBox = true
        boxError = nil
        upgradeRequired = false
        defer { creatingBox = false }
        do {
            let created: AgentDevice = try await WorkspaceAPI.request(
                "agent/devices/boxes", token: token, method: "POST",
                body: .object(["teamId": .string(team.id)])
            )
            guard session.token == token, store?.selectedTeam?.id == team.id else { return }
            cloudBox = created
        } catch AgentChatAPI.Conflict.other(code: "box_vcpu_limit", message: _, status: 402) {
            guard session.token == token, store?.selectedTeam?.id == team.id else { return }
            upgradeRequired = true
        } catch {
            guard session.token == token, store?.selectedTeam?.id == team.id else { return }
            boxError = error.localizedDescription
            // A response can be lost after the Box was created; refresh before offering another.
            await refreshRuntimes(checkCloud: true)
        }
    }

    private var moreMenu: some View {
        Menu {
            // Back to sign-in, where another account can be used: not destructive, so not red.
            Button {
                Task { await signOutAndRestart() }
            } label: {
                Label("Switch account", image: "lucide-log-out")
            }
            Button(action: restart) {
                Label("Restart", image: "lucide-rotate-cw")
            }
            Divider()
            // Shown as the menu's quiet footer, for support.
            Text("Nuphos \(versionLabel)")
        } label: {
            LucideIcon("ellipsis")
        }
        .accessibilityLabel("More")
    }

    private var versionLabel: String {
        let info = Bundle.main.infoDictionary ?? [:]
        let version = info["CFBundleShortVersionString"] as? String ?? "—"
        let build = info["CFBundleVersion"] as? String ?? "—"
        return "\(version) (\(build))"
    }

    @ViewBuilder private func content(_ step: Step) -> some View {
        switch step {
        case .computer:
            computerSetup
        case .ownComputer:
            ownComputerSetup
        case .model:
            modelSetup
        case .modelConnection:
            intro("Connect an AI subscription", "Use your ChatGPT or Claude account to sign in on the runtime you want your Bot to use.")
            if workspaceDraft == nil && !runtimes.isEmpty {
                primary("Choose a runtime") { path.append(.runtimes) }
            } else {
                Text("Connect a computer first. You can come back to this after its runtime is ready.")
                    .foregroundStyle(Theme.body)
            }
            Button("Set up later") { path.append(.nextStage) }.frame(minHeight: 44)
        case .consent, .workspace, .runtimes:
            EmptyView()
        case .nextStage:
            if let workspaceDraft {
                intro("Finish account setup", "Create \(workspaceDraft) to finish this part of setup.")
                primary("Create workspace") { Task { await saveWorkspace() } }
                    .disabled(savingWorkspace)
                if let workspaceError { Text(workspaceError).foregroundStyle(Theme.attention) }
            } else {
                intro("Account setup complete", "Next, get to know Nuphos and set your preferences.")
            }
        }
    }

    private func saveWorkspace() async {
        guard !savingWorkspace, let name = workspaceDraft, let token = session.token, let store else { return }
        savingWorkspace = true
        workspaceError = nil
        defer { savingWorkspace = false }
        do {
            let result: WorkspaceAPI.TeamEnvelope = try await WorkspaceAPI.request(
                "teams", token: token, method: "POST", body: .object(["name": .string(name)])
            )
            guard session.token == token else { return }
            await store.loadTeams()
            store.select(team: result.team)
            workspaceDraft = nil
            if path.last == .ownComputer { await refreshOwnComputer() }
        } catch {
            workspaceError = error.localizedDescription
        }
    }

    private var computerSetup: some View {
        VStack(alignment: .leading, spacing: 18) {
            intro("Where will your Bot work?", "Choose the computer that will run your Bot’s tasks.")
            if !selfHosted {
                setupOption("Use Nuphos Cloud", detail: "Run your Bot on a cloud computer with a Nuphos subscription.", icon: "cloud") {
                    showingCloudPlan = true
                }
            }
            setupOption("Use my own computer", detail: ownComputerDetail, icon: "desktopcomputer") {
                path.append(.ownComputer)
            }
        }
    }

    private var ownComputerSetup: some View {
        VStack(alignment: .leading, spacing: 20) {
            intro("Connect your own computer", "Set up the runtime on the computer you want your Bot to use.")
            VStack(alignment: .leading, spacing: 14) {
                computerStatus("Install Nuphos Desktop", "Download Nuphos from nuphos.ai on your computer and open it.", icon: "arrow.down.to.line")
                computerStatus("Open your workspace", "Sign in with the same account and select this workspace.", icon: "person.crop.circle")
                computerStatus("Add a runtime", "Open Computers, select your computer, and add a runtime. Then return here.", icon: "desktopcomputer")
            }
            .padding(16)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.card))
            if let workspaceDraft {
                Text("Create \(workspaceDraft) first so you can select it on your computer.")
                    .foregroundStyle(Theme.body)
                primary("Create workspace to set up a computer") { Task { await saveWorkspace() } }
                    .disabled(savingWorkspace)
                if let workspaceError { Text(workspaceError).foregroundStyle(Theme.attention) }
            } else if !personalRuntimes.isEmpty {
                primary("Continue") { path.append(.model) }
            } else {
                if let runtimeError { Text(runtimeError).foregroundStyle(Theme.attention) }
                primary(runtimeRefreshing ? "Checking…" : "Check connection") { Task { await refreshOwnComputer() } }
                    .disabled(runtimeRefreshing)
            }
            Button("Choose a model first") { path.append(.model) }
                .frame(minHeight: 44)
                .disabled(savingWorkspace)
        }
    }

    private var cloudPlanSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    cloudPlan
                }
                .padding(24)
                .frame(maxWidth: 480, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .foregroundStyle(Theme.heading)
            .background(Theme.canvas)
            .navigationTitle("Nuphos Cloud")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { showingCloudPlan = false }
                        .labelStyle(.iconOnly)
                }
            }
            .task {
                if workspaceDraft == nil { await refreshRuntimes(checkCloud: true) }
            }
            .task(id: cloudBox?.deviceId) {
                guard cloudBox != nil, !hasCloudRuntime else { return }
                for _ in 0..<40 {
                    do { try await Task.sleep(for: .seconds(3)) } catch { return }
                    await refreshRuntimes()
                    if hasCloudRuntime { return }
                }
            }
        }
    }

    @ViewBuilder private var cloudPlan: some View {
        if workspaceDraft == nil && !computerChecked {
            computerProgress("Checking your Cloud Box access…")
        } else if hasCloudRuntime && workspaceDraft == nil {
            intro("Your Cloud Box is ready", "Choose how your Bot uses AI.")
            primary("Continue") {
                showingCloudPlan = false
                path.append(.model)
            }
        } else if creatingBox {
            computerProgress("Creating your Cloud Box…")
        } else if let cloudBox, workspaceDraft == nil {
            intro("Waiting for \(cloudBox.label)", "Continue when your Box’s runtime connects.")
            Button("Check again") { Task { await refreshRuntimes(checkCloud: true) } }
                .disabled(runtimeRefreshing)
        } else if workspaceDraft == nil && cloudAvailable && boxUsage?.canCreate == true && !upgradeRequired {
            intro("Set up your Cloud Box", "Use your workspace’s available capacity to create a computer.")
            primary("Create a Cloud Box") { Task { await createCloudBox() } }
            if let boxError { Text(boxError).foregroundStyle(Theme.attention) }
        } else {
            cloudPaywall
        }
    }

    private var cloudPaywall: some View {
        VStack(alignment: .leading, spacing: 24) {
            intro("Nuphos Cloud", "Run your Bots on a cloud computer.")
            VStack(alignment: .leading, spacing: 18) {
                computerStatus("A computer for your Bots", "Let your Bots work even when your own computer is off.", icon: "cloud")
                Divider()
                computerStatus("Choose how your Bots use AI", "Use OpenCode or connect your own ChatGPT or Claude subscription.", icon: "sparkles")
            }
            .padding(20)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.card))
            primary("Subscribe to Nuphos Cloud") {}
                .disabled(true)
            Button("Restore purchases") {}
                .disabled(true)
            Text("Purchases are unavailable in this preview.")
                .font(.footnote).foregroundStyle(Theme.muted)
        }
    }

    private var modelSetup: some View {
        VStack(alignment: .leading, spacing: 18) {
            intro("Choose how your Bot uses AI", "Use a free OpenCode model or bring your own subscription.")
            setupOption("Use OpenCode", detail: "Start with a free model. No AI subscription required.", icon: "sparkles") {
                if workspaceDraft == nil, let runtime = runtimes.first(where: { $0.provider == .opencode && $0.isSelectable }) {
                    store?.selectRuntime(runtime)
                }
                path.append(.nextStage)
            }
            setupOption("Connect ChatGPT or Claude", detail: "Use an AI subscription you already have.", icon: "key") {
                path.append(.modelConnection)
            }
            if workspaceDraft != nil || !runtimes.contains(where: { $0.provider == .opencode && $0.isSelectable }) {
                Text("OpenCode can be set up after your computer connects.")
                    .font(.footnote).foregroundStyle(Theme.muted)
            }
        }
    }

    private func setupOption(_ title: LocalizedStringKey, detail: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                computerStatus(title, detail, icon: icon)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.muted)
                    .accessibilityHidden(true)
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.card))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func computerProgress(_ title: LocalizedStringKey) -> some View {
        HStack(spacing: 12) {
            ProgressView()
            Text(title).font(.subheadline).foregroundStyle(Theme.body)
        }
        .accessibilityElement(children: .combine)
    }

    private func computerStatus(_ title: LocalizedStringKey, _ detail: String, icon: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).font(.body).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundStyle(Theme.body)
            }
        }
    }

    // MARK: Actions

    private func signInToCloud() {
        UserDefaults.standard.removeObject(forKey: NuphosAPI.baseURLKey)
        signIn()
    }

    private func signIn() {
        showingLogin = true
    }

    private func completeLogin() {
        showingLogin = false
        startOnboarding()
    }

    private func editServer() {
        showingServer = true
    }

    private func startOnboarding() {
        path = []
        onboarding = true
    }

    private func restart() {
        if waitingForComputerPreview {
            returnToWelcome()
            return
        }
        path = []
        if rootStep == nil { setupAttempt += 1 }
    }

    private func returnToWelcome() {
        path = []
        rootStep = nil
        showedConsent = false
        waitingForComputerPreview = false
        tourFinished = false
        existingBot = false
        setupError = nil
        store = nil
        workspaceDraft = nil
        resetComputer()
        onboarding = false
    }

    private func resetComputer() {
        runtimes = []
        computerChecked = false
        runtimeError = nil
        cloudAvailable = false
        boxUsage = nil
        cloudBox = nil
        boxError = nil
        upgradeRequired = false
        workspaceError = nil
    }

    private func signOutAndRestart() async {
        session.signOut()
        returnToWelcome()
    }

    // MARK: Building blocks

    private func intro(_ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.title.bold()).accessibilityAddTraits(.isHeader)
            Text(detail).font(.subheadline).foregroundStyle(Theme.body)
        }
    }

    private func primary(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).frame(maxWidth: .infinity)
        }
        .buttonStyle(DesignPrimaryButtonStyle())
    }

    private func secondary(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.callout.weight(.medium)).frame(maxWidth: .infinity, minHeight: 36)
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.roundedRectangle(radius: Theme.Radius.button))
        .tint(Theme.heading)
    }

}
#endif
