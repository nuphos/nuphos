import Foundation
import Observation

/// Teams and the conversation list for the Agent page. One per signed-in
/// session; owns pagination, search and the selected team.
@Observable
final class AgentStore {
    /// What failed, and how to try it again.
    struct RowActionFailure {
        let title: String
        let message: String
        let retry: @MainActor () async -> Void
    }

    enum Phase: Equatable {
        case idle, loading, loaded, failed(String)
    }

    static let pageSize = 30
    private var lastTeamKey: String { "nuphos.workspace.lastTeamId.\(LaunchCache.accountKey(token))" }

    private(set) var teams: [Team] = []
    private(set) var teamsPhase: Phase = .idle
    private(set) var selectedTeam: Team?

    private(set) var conversations: [AgentConversation] = [] {
        didSet { BotFaces.shared.learn(conversations) }
    }
    private(set) var phase: Phase = .idle
    /// A list action or refresh that failed. The rows it acted on stay on screen.
    var rowActionFailure: RowActionFailure?
    /// Moves on with every change of workspace, so an answer to something done in
    /// the last one, even after coming back, is dropped rather than shown here.
    private var workspaceScope = 0
    /// Conversations with a Watch or Unwatch on its way.
    private(set) var watchChanges: Set<String> = []
    private(set) var isLoadingMore = false
    private(set) var hasMore = false
    private var nextCursor: String?

    // MARK: - Chats (channels)

    /// The chats the viewer owns or joined, newest activity first.
    private(set) var channels: [AgentConversation] = [] {
        didSet { BotFaces.shared.learn(channels) }
    }
    /// The viewer's own Bots, listed by the server rather than found in the loaded history.
    private(set) var bots: [AgentConversation] = []
    /// Set once the chats have loaded, so the home list can open on the right tab.
    private(set) var channelsLoaded = false

    /// Both listings the desktop sidebar reads: chats of one's own, then the ones joined.
    /// Then one's Bots, for those that have no chat yet.
    func loadChannels() async {
        guard let team = selectedTeam else { return }
        let query = search
        var rows: [AgentConversation] = []
        for scope in ["mine", "shared"] {
            guard let page = try? await NuphosAPI.conversations(
                token: token, teamId: team.id, limit: 100, search: query, scope: scope, channels: true
            ) else { return }
            let seen = Set(rows.map(\.sessionId))
            rows += page.conversations.filter { !seen.contains($0.sessionId) }
        }
        guard let botPage = try? await NuphosAPI.conversations(
            token: token, teamId: team.id, limit: 100, search: query, bots: true
        ) else { return }
        guard team.id == selectedTeam?.id, query == search, !Task.isCancelled else { return }
        channels = rows.sorted { $0.lastActiveAt > $1.lastActiveAt }
        bots = botPage.conversations
        if query.isEmpty { HomePage.hasChats = !botsList.isEmpty }
        channelsLoaded = true
    }

    func channel(for conversation: AgentConversation) -> ChannelSession {
        channel(sessionId: conversation.sessionId, title: conversation.displayTitle, teamId: conversation.teamId)
    }

    /// The open chat's poll. Owned here, not by a view: SwiftUI can cancel a
    /// view's tasks while it stays on screen (#1440) and keeps a closed chat's
    /// view, with its session, after going back.
    private var channelPoll: Task<Void, Never>?

    /// The open agent conversation's idle poll, owned here for the same reason.
    private var conversationPoll: (session: ChatSession, task: Task<Void, Never>)?

    /// The polls hold only their conversation, so they would outlive a signed-out store.
    deinit {
        channelPoll?.cancel()
        conversationPoll?.task.cancel()
    }

    /// Polls `channel` alone, or nothing when no chat is open.
    func poll(_ channel: ChannelSession?) {
        channelPoll?.cancel()
        channelPoll = channel.map { channel in Task { await channel.poll() } }
    }

    /// Follows `session` alone, or nothing when no conversation is open. The one
    /// it replaces stops polling and lets go of any run it was following.
    func follow(_ session: ChatSession?) {
        guard session !== conversationPoll?.session else { return }
        if let open = conversationPoll {
            open.task.cancel()
            open.session.leave()
        }
        conversationPoll = session.map { session in (session, Task { await session.pollWhileIdle() }) }
    }

    /// Stops following `session` if it is still the one followed.
    func unfollow(_ session: ChatSession) {
        if conversationPoll?.session === session { follow(nil) }
    }

    func channel(sessionId: String, title: String, teamId: String? = nil) -> ChannelSession {
        let channel = ChannelSession(token: token, teamId: teamId ?? selectedTeam?.id ?? "", channelId: sessionId, title: title)
        channel.viewerId = userId
        channel.me = me
        // The list row's icon shows at once; the chat's own load keeps it current.
        channel.faces = channels.first { $0.sessionId == sessionId }?.faces ?? []
        return channel
    }

    /// What Tasks lists: every agent, Bots too, by latest activity (#1691).
    var listedConversations: [AgentConversation] {
        conversations.sorted { $0.lastActiveAt > $1.lastActiveAt }
    }

    /// What Bots lists, newest first: every chat, and each Bot that has no
    /// 1:1 chat yet, by its face.
    var botsList: [AgentConversation] {
        let chatted = Set(channels.compactMap(\.botId))
        let unchatted = bots.filter { $0.isBot && !chatted.contains($0.sessionId) }
        return (channels + unchatted).sorted { $0.lastActiveAt > $1.lastActiveAt }
    }

    // MARK: - Archive

    func archive(sessionId: String, teamId: String?) async {
        guard let teamId = teamId ?? selectedTeam?.id else { return }
        let scope = workspaceScope
        do {
            try await AgentChatAPI.setArchived(token: token, teamId: teamId, sessionId: sessionId, archived: true)
            guard scope == workspaceScope else { return }
            removeFromList(sessionId)
            // A Bot goes with its chat on the server, so the chats list drops it too.
            await loadChannels()
        } catch {
            rowActionFailed(error, scope: scope) { [weak self] in await self?.archive(sessionId: sessionId, teamId: teamId) }
        }
    }

    /// The backend also unwatches the threads below, on any page. Reloading
    /// replaces every row with what it did, as rename and runtime moves do,
    /// instead of repeating that cascade here.
    func setWatching(_ watching: Bool, conversation: AgentConversation) async {
        guard let teamId = conversation.teamId ?? selectedTeam?.id,
              watchChanges.insert(conversation.sessionId).inserted else { return }
        let scope = workspaceScope
        do {
            try await AgentChatAPI.setWatching(token: token, teamId: teamId, sessionId: conversation.sessionId, watching: watching)
            watchChanges.remove(conversation.sessionId)
            guard scope == workspaceScope else { return }
            // At once, so a failed read below leaves the row saying what was saved.
            if let index = conversations.firstIndex(where: { $0.sessionId == conversation.sessionId }) {
                conversations[index].watching = watching
            }
            await reload(afterChange: true)
        } catch {
            watchChanges.remove(conversation.sessionId)
            rowActionFailed(error, scope: scope) { [weak self] in await self?.setWatching(watching, conversation: conversation) }
        }
    }

    private func rowActionFailed(_ error: Error, scope: Int, retry: @escaping @MainActor () async -> Void) {
        guard scope == workspaceScope else { return }
        rowActionFailure = RowActionFailure(title: "Couldn't save the change", message: error.localizedDescription) { [weak self] in
            guard self?.workspaceScope == scope else { return }
            await retry()
        }
    }

    /// Drops a chat that was archived. The poller
    /// keeps rows its first page misses, so it would not drop it; reads
    /// already in flight are discarded so they cannot bring it back. Before
    /// the list has loaded, the discarded read is the load itself, so start
    /// it again.
    func removeFromList(_ sessionId: String) {
        conversations.removeAll { $0.sessionId == sessionId }
        if phase == .loaded { loadGeneration += 1 } else { Task { await reload() } }
    }

    // MARK: - Threads

    private static let foldedThreadsKey = "nuphos.agent.foldedThreads"
    /// Thread parents folded on the Agent page, per team.
    private var foldedThreads: [String: Set<String>] =
        (UserDefaults.standard.dictionary(forKey: AgentStore.foldedThreadsKey) as? [String: [String]] ?? [:])
            .mapValues(Set.init)

    /// The Tasks rows: agent-opened threads under the conversation that opened them.
    var nestedConversations: [NestedConversation] {
        ConversationNesting.nest(listedConversations, folded: foldedThreads[selectedTeam?.id ?? ""] ?? [])
    }

    func isFolded(_ sessionId: String) -> Bool { foldedThreads[selectedTeam?.id ?? ""]?.contains(sessionId) == true }

    func toggleFolded(_ sessionId: String) {
        guard let team = selectedTeam?.id else { return }
        var folded = foldedThreads[team] ?? []
        if folded.remove(sessionId) == nil { folded.insert(sessionId) }
        foldedThreads[team] = folded
        UserDefaults.standard.set(foldedThreads.mapValues(Array.init), forKey: Self.foldedThreadsKey)
    }

    func rename(_ conversation: AgentConversation, title: String) async {
        guard conversation.ownsChat, let teamId = conversation.teamId ?? selectedTeam?.id else { return }
        let scope = workspaceScope
        do {
            try await AgentChatAPI.rename(token: token, teamId: teamId, sessionId: conversation.sessionId, title: title)
            guard scope == workspaceScope else { return }
            await reload(afterChange: true)
        } catch {
            rowActionFailed(error, scope: scope) { [weak self] in await self?.rename(conversation, title: title) }
        }
    }

    /// While a Bot's first chat waits for the server, so a second tap makes no second one.
    private(set) var creatingBot = false

    /// A Bot's 1:1 chat, made the first time it is opened (#1691). Throws
    /// to the screen that asked, which says so and offers to try again.
    func botChannel(botId: String) async throws -> ChannelSession? {
        if let chat = channels.first(where: { $0.botId == botId }) { return channel(for: chat) }
        guard let teamId = selectedTeam?.id, !creatingBot else { return nil }
        creatingBot = true
        defer { creatingBot = false }
        let scope = workspaceScope
        let id = try await AgentChatAPI.createBotChannel(token: token, teamId: teamId, botId: botId)
        guard scope == workspaceScope else { return nil }
        await loadChannels()
        let title = (conversations + bots).first { $0.sessionId == botId }?.displayTitle ?? ""
        return channel(sessionId: id, title: channels.first { $0.sessionId == id }?.displayTitle ?? title, teamId: teamId)
    }

    /// "+" on Bots: makes the Bot with the picked name and face and returns
    /// its id. Throws to the New Bot sheet, which stays open.
    func createBot(title: String, avatar: String) async throws -> String? {
        guard let teamId = selectedTeam?.id else { return nil }
        let scope = workspaceScope
        let id = try await AgentChatAPI.createBot(token: token, teamId: teamId, title: title, avatar: avatar, runtime: newConversationRuntime)
        guard scope == workspaceScope else { return nil }
        await reload(afterChange: true)
        return id
    }

    /// "Make this a Bot" or "Turn into a Task". Whether it was saved.
    func setBot(_ bot: Bool, conversation: AgentConversation) async -> Bool {
        guard conversation.ownsChat, let teamId = conversation.teamId ?? selectedTeam?.id else { return false }
        let scope = workspaceScope
        do {
            try await AgentChatAPI.setBot(bot, token: token, teamId: teamId, sessionId: conversation.sessionId)
            guard scope == workspaceScope else { return false }
            await reload(afterChange: true)
            return true
        } catch {
            rowActionFailed(error, scope: scope) { [weak self] in _ = await self?.setBot(bot, conversation: conversation) }
            return false
        }
    }

    func unlinkParent(_ conversation: AgentConversation) async {
        guard conversation.ownsChat, let teamId = conversation.teamId ?? selectedTeam?.id else { return }
        let scope = workspaceScope
        do {
            try await AgentChatAPI.unlinkParent(token: token, teamId: teamId, sessionId: conversation.sessionId)
            guard scope == workspaceScope else { return }
            if let index = conversations.firstIndex(where: { $0.sessionId == conversation.sessionId }) {
                conversations[index].parentSessionId = nil
            }
        } catch {
            rowActionFailed(error, scope: scope) { [weak self] in await self?.unlinkParent(conversation) }
        }
    }

    // MARK: - Runtimes

    private(set) var runtimes: [RuntimeInstance] = []
    private(set) var runtimesLoaded = false
    private(set) var runtimesError: String?
    /// Usage by runtime id; missing while loading or when a lookup fails.
    private(set) var quotas: [String: RuntimeQuota] = [:]
    /// Remembered per team; an unavailable remembered choice means "pick
    /// again", never a silent switch to another account.
    private(set) var selectedRuntimeId: String?

    private func runtimeKey(for team: Team) -> String { "nuphos.agent.runtimeInstance.\(LaunchCache.accountKey(token)).\(team.id)" }

    var newConversationRuntime: RuntimeInstance? {
        if let selectedRuntimeId { return runtimes.first { $0.id == selectedRuntimeId && $0.isSelectable } }
        return RuntimeInstance.defaultPick(runtimes)
    }

    /// The remembered agent is offline, signed out or gone.
    var selectedRuntimeUnavailable: Bool {
        selectedTeam == nil || !runtimesLoaded || newConversationRuntime == nil
    }

    func selectRuntime(_ runtime: RuntimeInstance) {
        guard let team = selectedTeam else { return }
        selectedRuntimeId = runtime.id
        UserDefaults.standard.set(runtime.id, forKey: runtimeKey(for: team))
        publishSharingContext()
    }

    func loadRuntimes(force: Bool = false) async {
        guard let team = selectedTeam, force || !runtimesLoaded else { return }
        do {
            let next = try await NuphosAPI.runtimeInstances(token: token, teamId: team.id)
            guard !Task.isCancelled, selectedTeam?.id == team.id else { return }
            runtimes = next
            runtimesError = nil
            runtimesLoaded = true
            publishSharingContext()
        } catch {
            guard !Task.isCancelled, selectedTeam?.id == team.id else { return }
            runtimesError = error.localizedDescription
        }
    }

    private(set) var agentDevices: [AgentDevice] = []
    private(set) var agentDevicesError = false

    func loadAgentDevices() async {
        guard let team = selectedTeam else { return }
        struct Envelope: Decodable { let devices: [AgentDevice] }
        do {
            let query = [URLQueryItem(name: "metrics", value: "true"), URLQueryItem(name: "teamId", value: team.id)]
            let data = try await AgentChatAPI.send("GET", "agent/devices", query: query, token: token, body: JSONValue?.none)
            let result = try JSONDecoder().decode(Envelope.self, from: data)
            guard !Task.isCancelled, selectedTeam?.id == team.id else { return }
            agentDevices = result.devices
            agentDevicesError = false
        } catch {
            guard !Task.isCancelled, selectedTeam?.id == team.id else { return }
            agentDevicesError = true
        }
    }

    /// Reloads devices until cancelled: every 5s, but after 1s while a host
    /// has no fresh reading yet, since older hosts only start sampling once asked.
    func pollAgentDevices() async {
        for round in 0... {
            await loadAgentDevices()
            let settling = round < 5 && agentDevices.contains { $0.metricsStatus == "waiting" || $0.metricsStatus == "stale" }
            do { try await Task.sleep(for: .seconds(settling ? 1 : 5)) } catch { return }
        }
    }

    func loadQuotas() async {
        guard let team = selectedTeam,
              let list = try? await NuphosAPI.runtimeQuotas(token: token, teamId: team.id),
              team.id == selectedTeam?.id else { return }
        quotas = Dictionary(list.map { ($0.runtimeId, $0) }) { _, last in last }
    }

    private(set) var newModelConfig: SessionConfigState?
    private(set) var newModelError: String?
    private(set) var newModelSaving = false
    private var newModelRuntimeId: String?
    private var newModelRequest = UUID()
    /// Settings picked for the next new conversation; its first message carries them.
    private var newModelPick: [String: String] = [:]

    var canConfigureNewModel: Bool { newConversationRuntime != nil }

    var newModelTitle: String {
        if newModelRuntimeId == newConversationRuntime?.id, let newModelConfig { return newModelConfig.modelTitle }
        return "Model"
    }

    func loadNewModelConfig() async {
        guard let team = selectedTeam, let runtime = newConversationRuntime, canConfigureNewModel else {
            newModelConfig = nil
            newModelError = nil
            return
        }
        if newModelRuntimeId != runtime.id {
            newModelConfig = nil
            newModelError = nil
            newModelPick = [:]
            newModelRuntimeId = runtime.id
        }
        let request = UUID()
        newModelRequest = request
        do {
            let data = try await AgentChatAPI.send("GET", "teams/\(team.id)/agent-runtimes/\(runtime.id)/model-config",
                query: newModelPick.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) },
                token: token, body: Optional<Int>.none, timeout: 20)
            let config = try JSONDecoder().decode(SessionConfigState.self, from: data)
            guard newModelRequest == request, selectedTeam?.id == team.id, newConversationRuntime?.id == runtime.id else { return }
            newModelConfig = config
            newModelError = config.options.isEmpty ? "No models available. Try again." : nil
        } catch {
            guard newModelRequest == request, selectedTeam?.id == team.id, newConversationRuntime?.id == runtime.id else { return }
            newModelError = error.localizedDescription
        }
    }

    func setNewModelConfig(configId: String, value: String) async {
        guard !newModelSaving, canConfigureNewModel else { return }
        newModelSaving = true
        defer { newModelSaving = false }
        newModelPick[configId] = value
        await loadNewModelConfig()
    }

    private func resetTeamScopedState() {
        workspaceScope += 1
        rowActionFailure = nil
        newModelRequest = UUID()
        newModelRuntimeId = nil
        newModelConfig = nil
        newModelError = nil
        newModelPick = [:]
        credentials.reset()
        channels = []
        bots = []
        runtimes = []
        agentDevices = []
        agentDevicesError = false
        runtimesLoaded = false
        quotas = [:]
        selectedRuntimeId = selectedTeam.flatMap { UserDefaults.standard.string(forKey: runtimeKey(for: $0)) }
    }
    var search = "" {
        didSet { if search != oldValue { scheduleSearch() } }
    }

    private let loadsHistory: Bool
    let token: String
    private var sharingOwner: SharedShareSession.Owner
    private var isShareEntry = false
    let unread: ConversationUnread
    let observations: RuntimeObservations
    private var searchTask: Task<Void, Never>?
    private var loadGeneration = 0
    private var loadedPageCursors: [String] = []
    private var refreshPageIndex = 0

    /// The viewer's own sessions whose title or first message contains
    /// `query`, newest first, other than `excluded` — what an `@` offers.
    func mentionableSessions(teamId: String, excluding excluded: String?, matching query: String) async -> [AgentConversation] {
        guard loadsHistory else { return [] }
        guard let page = try? await NuphosAPI.conversations(token: token, teamId: teamId, limit: 6, search: query) else { return [] }
        return Array(page.conversations.filter { $0.sessionId != excluded }.prefix(5))
    }

    // MARK: - Composer settings (IAM + permission mode)

    private var permissionModeKey: String { "nuphos.agentPermissionMode.\(LaunchCache.accountKey(token))" }

    private var credentials = CredentialDraft()
    var credentialCatalog: CredentialCatalog? { credentials.catalog }
    var credentialCatalogError: String? { credentials.error }
    var credentialsReady: Bool { credentials.isReady }
    /// What a new conversation starts with.
    var credentialSelection: CredentialSelection {
        get { credentials.selection }
        set { credentials.selection = newValue; publishSharingContext() }
    }
    /// Nothing stored yet means Full Access; anything unreadable fails safe
    /// to Auto Mode.
    var permissionMode: PermissionMode = .bypass {
        didSet { UserDefaults.standard.set(permissionMode.rawValue, forKey: permissionModeKey); publishSharingContext() }
    }

    /// Loads the IAM catalog for the selected team (cached per team).
    func loadCredentialOptions(force: Bool = false) async {
        guard let team = selectedTeam, force || credentialCatalog == nil else { return }
        let load = credentials.begin()
        do {
            credentials.finish(load, with: .success(try await NuphosAPI.credentialOptions(token: token, teamId: team.id)))
            publishSharingContext()
        } catch {
            credentials.finish(load, with: .failure(error))
        }
    }

    /// The signed-in user, for sessions to label what they send.
    var me: ChatMessage.Sender?
    /// The signed-in person's id: whose computers open their desktop from the Runtimes page.
    var userId: String?

    init(token: String, loadsHistory: Bool = true) {
        self.loadsHistory = loadsHistory
        self.token = token
        sharingOwner = SharedShareSession.Owner(token: token)
        unread = ConversationUnread.forAccount(token)
        observations = RuntimeObservations.forAccount(token)
        if let stored = UserDefaults.standard.string(forKey: permissionModeKey) {
            permissionMode = stored == PermissionMode.bypass.rawValue ? .bypass : .auto
        }
        unread.markRead = { team, session, seq in
            try? await AgentChatAPI.markRead(token: token, teamId: team, sessionId: session, seq: seq)
        }
        unread.probe = { team, session in
            _ = try? await NuphosAPI.conversationDetail(token: token, teamId: team, sessionId: session, tail: 1)
        }
        // The list the last launch showed, until `loadTeams` refreshes it.
        if let cached = LaunchCache.read(LaunchCache.Agents.self), cached.accountKey == LaunchCache.accountKey(token) {
            selectedTeam = cached.team
            conversations = cached.conversations
            selectedRuntimeId = UserDefaults.standard.string(forKey: runtimeKey(for: cached.team))
            phase = .loaded
        }
    }

    // MARK: - Teams

    /// Loads teams and picks the last-used one (or the first). Reloads the
    /// list if the selection changed.
    func loadTeams() async {
        teamsPhase = .loading
        do {
            let firstLoad = self.teams.isEmpty
            let teams = try await NuphosAPI.teams(token: token)
            self.teams = teams
            teamsPhase = .loaded
            let remembered = UserDefaults.standard.string(forKey: lastTeamKey)
            let pick = teams.first { $0.id == remembered } ?? teams.first
            if pick != selectedTeam || phase == .idle {
                selectedTeam = pick
                resetTeamScopedState()
                await reload()
            } else if firstLoad || isFailed {
                // Showing the launch cache, or a failed list: read it again.
                await reload()
            }
        } catch {
            teamsPhase = .failed(error.localizedDescription)
            if teams.isEmpty && conversations.isEmpty { phase = .failed(error.localizedDescription) }
        }
    }

    func select(team: Team) {
        guard team != selectedTeam else { return }
        selectedTeam = team
        Analytics.shared.track("team_switched", teamID: team.id)
        UserDefaults.standard.set(team.id, forKey: lastTeamKey)
        resetTeamScopedState()
        publishSharingContext()
        Task { await reload() }
    }

    func bindSharingLogin(_ loginID: UUID, token: String) {
        guard self.token == token, !isShareEntry, sharingOwner.bindVerified(loginID) else { return }
        publishSharingContext()
    }

    private func publishSharingContext() {
        guard !isShareEntry, let team = selectedTeam else { return }
        sharingOwner.update(.init(teamID: team.id, runtimeID: newConversationRuntime?.id,
                           credentials: credentialSelection.json, permissionMode: permissionMode.rawValue))
    }

    /// Strictly the containing app's workspace: no fallback to the first team,
    /// and no conversation/favorites/history request on the share entry path.
    func prepareForSharing(_ lease: SharedShareSession.Record) async throws {
        isShareEntry = true
        guard let context = lease.context else { throw SharedShareSession.Failure.workspace }
        try SharedShareSession.validate(lease)
        let teams = try await NuphosAPI.teams(token: token)
        try SharedShareSession.validate(lease)
        guard let team = teams.first(where: { $0.id == context.teamID }) else { throw SharedShareSession.Failure.workspace }
        self.teams = teams; teamsPhase = .loaded; selectedTeam = team
        resetTeamScopedState(); selectedRuntimeId = context.runtimeID
        permissionMode = PermissionMode(rawValue: context.permissionMode) ?? .auto
        await loadRuntimes()
        await loadCredentialOptions()
        try SharedShareSession.validate(lease)
        guard credentialsReady, credentialCatalog != nil else { throw SharedShareSession.Failure.workspace }
        if let selected = context.credentials { credentialSelection = CredentialSelection(json: selected).pruned(to: credentialCatalog!) }
        phase = .loaded
    }

    // MARK: - Conversations

    /// First page, replacing whatever is shown. Keeps the old rows visible
    /// while loading so a refresh does not flash empty.
    /// A failure keeps a list already on screen and reports it instead.
    /// `afterChange`: the read follows a change that was saved.
    func reload(afterChange: Bool = false) async {
        guard let team = selectedTeam else {
            conversations = []
            phase = teamsPhase == .loaded ? .loaded : phase
            return
        }
        if !loadsHistory {
            phase = .loaded
            await loadRuntimes()
            return
        }
        loadGeneration += 1
        loadedPageCursors = []
        refreshPageIndex = 0
        let generation = loadGeneration
        if conversations.isEmpty { phase = .loading }
        async let runtimesLoad: () = loadRuntimes()
        async let channelsLoad: () = loadChannels()

        do {
            let page = try await NuphosAPI.conversations(
                token: token, teamId: team.id, limit: Self.pageSize, search: search
            )
            _ = await (runtimesLoad, channelsLoad)
            guard generation == loadGeneration else { return }
            conversations = page.rows
            nextCursor = page.nextCursor
            hasMore = page.hasMore
            phase = .loaded
            if search.isEmpty {
                LaunchCache.write(LaunchCache.Agents(team: team, conversations: page.rows, accountKey: LaunchCache.accountKey(token)))
            }
        } catch {
            guard generation == loadGeneration else { return }
            guard phase == .loaded else {
                phase = .failed(error.localizedDescription)
                return
            }
            rowActionFailure = RowActionFailure(
                title: "Couldn't refresh the list",
                message: afterChange ? "Your change was saved, but the list could not refresh." : error.localizedDescription,
                retry: { [weak self] in await self?.reload() }
            )
        }
    }

    private var isFailed: Bool {
        if case .failed = phase { true } else { false }
    }

    /// Next page, appended. Rows can repeat across pages because the cursor
    /// is a timestamp, so dedupe by session id.
    func loadMore() async {
        guard loadsHistory else { return }
        guard hasMore, !isLoadingMore, let team = selectedTeam, let cursor = nextCursor else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        let generation = loadGeneration

        do {
            let page = try await NuphosAPI.conversations(
                token: token, teamId: team.id, cursor: cursor, limit: Self.pageSize, search: search
            )
            guard generation == loadGeneration else { return }
            if !loadedPageCursors.contains(cursor) { loadedPageCursors.append(cursor) }
            let seen = Set(conversations.map(\.sessionId))
            conversations.append(contentsOf: page.rows.filter { !seen.contains($0.sessionId) })
            nextCursor = page.nextCursor
            hasMore = page.hasMore
        } catch {
            // Leave what we have; the sentinel row offers a retry.
        }
    }

    /// A live session for an existing conversation, already loading. The
    /// load belongs to the session, not to the view showing it, so a view
    /// SwiftUI cancels or keeps cannot leave it unloaded.
    func session(for conversation: AgentConversation) -> ChatSession {
        let session = ChatSession(
            token: token,
            teamId: conversation.teamId ?? selectedTeam?.id ?? "",
            sessionId: conversation.sessionId,
            title: conversation.displayTitle,
            agentRuntime: conversation.agentRuntime,
            runtimeLabel: conversation.runtimeLabel
        )
        session.me = me
        Task { await session.load() }
        return session
    }

    /// A live session for a conversation known only by id — a plan's source
    /// conversation, for instance. Foreign sessions come back read-only.
    func session(sessionId: String, title: String, teamId: String? = nil) -> ChatSession {
        let session = ChatSession(token: token, teamId: teamId ?? selectedTeam?.id ?? "", sessionId: sessionId, title: title)
        session.me = me
        Task { await session.load() }
        return session
    }

    /// A brand-new conversation for the selected team.
    /// Nil until the credential defaults are in place (or failed to load), so
    /// no entry point can start a conversation with nothing selected.
    func newSession() -> ChatSession? {
        guard let team = selectedTeam, credentialsReady else { return nil }
        let session = ChatSession.fresh(token: token, teamId: team.id)
        session.me = me
        session.presetPermissionMode(permissionMode)
        session.credentialAccess = credentialSelection.isEmpty ? nil : credentialSelection
        session.runtime = newConversationRuntime
        if newModelRuntimeId == newConversationRuntime?.id { session.presetSessionConfig(newModelConfig, pick: newModelPick) }
        return session
    }

    private var poller: Task<Void, Never>?

    /// Keeps the first page fresh for as long as the store lives — also while
    /// a chat sits on top of the list — so replies running elsewhere (desktop,
    /// Slack, wake-ups) show up and clear, and coming back from a chat never
    /// shows a stale row. A view's `.task` would stop whenever a chat is
    /// pushed. iOS suspends it with the app.
    func startPolling() {
        guard loadsHistory else { return }
        guard poller == nil else { return }
        poller = Task { [weak self] in
            while !Task.isCancelled {
                guard let store = self else { return }
                await store.pollOnce()
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    private func pollOnce() async {
        // A failed list keeps polling too, so it comes back on its own.
        guard phase == .loaded || isFailed, !isLoadingMore else { return }
        async let chats: () = loadChannels()
        await refreshFirstPage()
        await chats
    }

    /// At most two requests per tick: page one and one rotating loaded page.
    /// Scrolling increases the rotation interval, never the request burst size.
    private func refreshFirstPage() async {
        guard let team = selectedTeam else { return }
        let generation = loadGeneration
        guard let page = try? await NuphosAPI.conversations(
            token: token, teamId: team.id, limit: Self.pageSize, search: search
        ), generation == loadGeneration, !Task.isCancelled else { return }
        conversations = conversations.refreshed(firstPage: page.rows)
        if isFailed { phase = .loaded }
        if loadedPageCursors.isEmpty, !isLoadingMore, conversations.count <= page.rows.count {
            nextCursor = page.nextCursor
            hasMore = page.hasMore
        }
        guard !loadedPageCursors.isEmpty else { return }
        let cursor = loadedPageCursors[refreshPageIndex % loadedPageCursors.count]
        refreshPageIndex = (refreshPageIndex + 1) % loadedPageCursors.count
        guard let background = try? await NuphosAPI.conversations(
            token: token, teamId: team.id, cursor: cursor, limit: Self.pageSize, search: search
        ), generation == loadGeneration, !Task.isCancelled else { return }
        let fresh = Dictionary(background.rows.map { ($0.sessionId, $0) }, uniquingKeysWith: { first, _ in first })
        conversations = conversations.map { fresh[$0.sessionId] ?? $0 }
    }

    /// Search is server-backed; debounce like the desktop (250 ms).
    private func scheduleSearch() {
        searchTask?.cancel()
        loadGeneration += 1 // Results for the old query are stale, including the load just cancelled.
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await reload()
        }
    }
}
