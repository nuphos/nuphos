import Foundation
import Observation

/// Teams and the conversation list for the Agent page. One per signed-in
/// session; owns pagination, search and the selected team.
@Observable
final class AgentStore {
    enum Phase: Equatable {
        case idle, loading, loaded, failed(String)
    }

    static let pageSize = 30
    private static let lastTeamKey = "nuphos.workspace.lastTeamId"

    private(set) var teams: [Team] = []
    private(set) var teamsPhase: Phase = .idle
    private(set) var selectedTeam: Team?

    private(set) var conversations: [AgentConversation] = []
    private(set) var phase: Phase = .idle
    private(set) var isLoadingMore = false
    private(set) var hasMore = false
    private var nextCursor: String?

    var scope: NuphosAPI.ConversationScope = .mine {
        didSet { if scope != oldValue { Task { await reload() } } }
    }
    /// Archived chats only (the default list excludes them; the backend
    /// auto-archives idle chats after a week).
    var showArchived = false {
        didSet { if showArchived != oldValue { Task { await reload() } } }
    }
    /// The desktop sidebar lists by creation date.
    var sort: NuphosAPI.ConversationSort = .created {
        didSet { if sort != oldValue { Task { await reload() } } }
    }

    // MARK: - Pinned chats (sidebar favorites)

    private(set) var favorites: SidebarFavorites?
    var pinnedSessionIds: Set<String> { favorites?.pinnedSessionIds ?? [] }
    /// Pinned entries, newest pin first.
    var pinnedChats: [SidebarFavorites.Entry] { (favorites?.entries ?? []).filter { $0.sessionId != nil }.reversed() }

    func isPinned(_ sessionId: String) -> Bool { pinnedSessionIds.contains(sessionId) }

    func loadFavorites() async {
        guard let team = selectedTeam else { return }
        favorites = try? await NuphosAPI.sidebarFavorites(token: token, teamId: team.id)
    }

    /// Pins or unpins; retried once on a stale revision.
    func setPinned(_ pinned: Bool, sessionId: String, title: String) async {
        guard let team = selectedTeam else { return }
        for _ in 0..<2 {
            var loaded = favorites
            if loaded == nil { loaded = try? await NuphosAPI.sidebarFavorites(token: token, teamId: team.id) }
            let current = loaded ?? SidebarFavorites(entries: [], revision: 0)
            var entries = current.entries.filter { $0.sessionId != sessionId }
            if pinned { entries.append(.chat(sessionId: sessionId, label: title)) }
            do {
                favorites = try await AgentChatAPI.putSidebarFavorites(token: token, teamId: team.id, entries: entries, expectedRevision: current.revision)
                return
            } catch AgentChatAPI.Conflict.favoritesChanged {
                favorites = try? await NuphosAPI.sidebarFavorites(token: token, teamId: team.id)
            } catch {
                return
            }
        }
    }

    // MARK: - Archive

    func setArchived(_ archived: Bool, conversation: AgentConversation) async {
        guard conversation.canManage, let teamId = conversation.teamId ?? selectedTeam?.id else { return }
        do {
            try await AgentChatAPI.setArchived(token: token, teamId: teamId, sessionId: conversation.sessionId, archived: archived)
            conversations.removeAll { $0.sessionId == conversation.sessionId }
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    // MARK: - Runtimes

    private(set) var runtimes: [RuntimeInstance] = []
    private(set) var runtimesLoaded = false
    private(set) var runtimesError: String?
    /// Remembered per team; an unavailable remembered choice means "pick
    /// again", never a silent switch to another account.
    private(set) var selectedRuntimeId: String?

    private func runtimeKey(for team: Team) -> String { "nuphos.agent.runtimeInstance.\(team.id)" }

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
    }

    func loadRuntimes(force: Bool = false) async {
        guard let team = selectedTeam, force || !runtimesLoaded else { return }
        do {
            runtimes = try await NuphosAPI.runtimeInstances(token: token, teamId: team.id)
            runtimesError = nil
            runtimesLoaded = true
        } catch {
            runtimesError = error.localizedDescription
        }
    }

    private func resetTeamScopedState() {
        credentialCatalog = nil
        favorites = nil
        runtimes = []
        runtimesLoaded = false
        selectedRuntimeId = selectedTeam.flatMap { UserDefaults.standard.string(forKey: runtimeKey(for: $0)) }
        restoreCredentialSelection()
    }
    var search = "" {
        didSet { if search != oldValue { scheduleSearch() } }
    }

    private let token: String
    private var searchTask: Task<Void, Never>?
    private var loadGeneration = 0
    private var loadedPageCursors: [String] = []
    private var refreshPageIndex = 0

    // MARK: - Composer settings (IAM + permission mode)

    private static let permissionModeKey = "nuphos.agentPermissionMode"

    private(set) var credentialCatalog: CredentialCatalog?
    private(set) var credentialCatalogError: String?
    var credentialSelection = CredentialSelection() {
        didSet { persistCredentialSelection() }
    }
    /// Nothing stored yet means Full Access; anything unreadable fails safe
    /// to Auto Mode.
    var permissionMode: PermissionMode = {
        guard let stored = UserDefaults.standard.string(forKey: AgentStore.permissionModeKey) else { return .bypass }
        return stored == PermissionMode.bypass.rawValue ? .bypass : .auto
    }() {
        didSet { UserDefaults.standard.set(permissionMode.rawValue, forKey: Self.permissionModeKey) }
    }

    private func credentialSelectionKey(for team: Team) -> String { "nuphos.credentialSelection.\(team.id)" }

    private func restoreCredentialSelection() {
        guard let team = selectedTeam,
              let data = UserDefaults.standard.data(forKey: credentialSelectionKey(for: team)),
              let saved = try? JSONDecoder().decode(CredentialSelection.self, from: data)
        else { credentialSelection = CredentialSelection(); return }
        credentialSelection = saved
    }

    private func persistCredentialSelection() {
        guard let team = selectedTeam, let data = try? JSONEncoder().encode(credentialSelection) else { return }
        UserDefaults.standard.set(data, forKey: credentialSelectionKey(for: team))
    }

    /// Loads the IAM catalog for the selected team (cached per team).
    func loadCredentialOptions(force: Bool = false) async {
        guard let team = selectedTeam, force || credentialCatalog == nil else { return }
        do {
            let catalog = try await NuphosAPI.credentialOptions(token: token, teamId: team.id)
            credentialCatalog = catalog
            credentialCatalogError = nil
            credentialSelection = credentialSelection.pruned(to: catalog)
        } catch {
            credentialCatalogError = error.localizedDescription
        }
    }

    init(token: String) {
        self.token = token
        ConversationUnread.shared.markRead = { team, session, seq in
            try? await AgentChatAPI.markRead(token: token, teamId: team, sessionId: session, seq: seq)
        }
        ConversationUnread.shared.probe = { team, session in
            _ = try? await NuphosAPI.conversationDetail(token: token, teamId: team, sessionId: session, tail: 1)
        }
    }

    // MARK: - Teams

    /// Loads teams and picks the last-used one (or the first). Reloads the
    /// list if the selection changed.
    func loadTeams() async {
        teamsPhase = .loading
        do {
            let teams = try await NuphosAPI.teams(token: token)
            self.teams = teams
            teamsPhase = .loaded
            let remembered = UserDefaults.standard.string(forKey: Self.lastTeamKey)
            let pick = teams.first { $0.id == remembered } ?? teams.first
            if pick != selectedTeam {
                selectedTeam = pick
                resetTeamScopedState()
                await reload()
            } else if phase == .idle {
                resetTeamScopedState()
                await reload()
            }
        } catch {
            teamsPhase = .failed(error.localizedDescription)
            if teams.isEmpty { phase = .failed(error.localizedDescription) }
        }
    }

    func select(team: Team) {
        guard team != selectedTeam else { return }
        selectedTeam = team
        UserDefaults.standard.set(team.id, forKey: Self.lastTeamKey)
        resetTeamScopedState()
        Task { await reload() }
    }

    // MARK: - Conversations

    /// First page, replacing whatever is shown. Keeps the old rows visible
    /// while loading so a refresh does not flash empty.
    func reload() async {
        guard let team = selectedTeam else {
            conversations = []
            phase = teamsPhase == .loaded ? .loaded : phase
            return
        }
        loadGeneration += 1
        loadedPageCursors = []
        refreshPageIndex = 0
        let generation = loadGeneration
        if conversations.isEmpty { phase = .loading }
        async let favoritesLoad: () = loadFavorites()
        async let runtimesLoad: () = loadRuntimes()

        do {
            let page = try await NuphosAPI.conversations(
                token: token, teamId: team.id, limit: Self.pageSize, scope: scope, search: search,
                archived: showArchived ? .only : .exclude, sort: sort
            )
            _ = await (favoritesLoad, runtimesLoad)
            guard generation == loadGeneration else { return }
            conversations = page.conversations
            nextCursor = page.nextCursor
            hasMore = page.hasMore
            phase = .loaded
        } catch {
            guard generation == loadGeneration else { return }
            phase = .failed(error.localizedDescription)
        }
    }

    /// Next page, appended. Rows can repeat across pages because the cursor
    /// is a timestamp, so dedupe by session id.
    func loadMore() async {
        guard hasMore, !isLoadingMore, let team = selectedTeam, let cursor = nextCursor else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        let generation = loadGeneration

        do {
            let page = try await NuphosAPI.conversations(
                token: token, teamId: team.id, cursor: cursor, limit: Self.pageSize, scope: scope, search: search,
                archived: showArchived ? .only : .exclude, sort: sort
            )
            guard generation == loadGeneration else { return }
            if !loadedPageCursors.contains(cursor) { loadedPageCursors.append(cursor) }
            let seen = Set(conversations.map(\.sessionId))
            conversations.append(contentsOf: page.conversations.filter { !seen.contains($0.sessionId) })
            nextCursor = page.nextCursor
            hasMore = page.hasMore
        } catch {
            // Leave what we have; the sentinel row offers a retry.
        }
    }

    /// A live session for an existing conversation (loads on first use).
    func session(for conversation: AgentConversation) -> ChatSession {
        ChatSession(
            token: token,
            teamId: conversation.teamId ?? selectedTeam?.id ?? "",
            sessionId: conversation.sessionId,
            title: conversation.displayTitle,
            agentRuntime: conversation.agentRuntime,
            runtimeLabel: conversation.runtimeLabel
        )
    }

    /// A live session for a conversation known only by id — a plan's source
    /// conversation, for instance. Foreign sessions come back read-only.
    func session(sessionId: String, title: String, teamId: String? = nil) -> ChatSession {
        ChatSession(token: token, teamId: teamId ?? selectedTeam?.id ?? "", sessionId: sessionId, title: title)
    }

    /// A brand-new conversation for the selected team.
    func newSession() -> ChatSession? {
        guard let team = selectedTeam else { return nil }
        let session = ChatSession.fresh(token: token, teamId: team.id)
        session.presetPermissionMode(permissionMode)
        session.credentialAccess = credentialSelection.isEmpty ? nil : credentialSelection
        session.runtime = newConversationRuntime
        return session
    }

    /// Keeps the first page fresh while the list is on screen, so replies
    /// running elsewhere (desktop, Slack, wake-ups) show up and clear. It
    /// refreshes on arrival: coming back from a chat, the rows still show
    /// the state from before it.
    func pollWhileVisible() async {
        while !Task.isCancelled {
            RuntimeObservations.shared.tick()
            if phase == .loaded, !isLoadingMore { await refreshFirstPage() }
            try? await Task.sleep(for: .seconds(3))
        }
    }

    /// At most two requests per tick: page one and one rotating loaded page.
    /// Scrolling increases the rotation interval, never the request burst size.
    private func refreshFirstPage() async {
        guard let team = selectedTeam else { return }
        let generation = loadGeneration
        guard let page = try? await NuphosAPI.conversations(
            token: token, teamId: team.id, limit: Self.pageSize, scope: scope, search: search,
            archived: showArchived ? .only : .exclude, sort: sort
        ), generation == loadGeneration, !Task.isCancelled else { return }
        let firstPageIds = Set(page.conversations.map(\.sessionId))
        conversations = page.conversations + conversations.filter { !firstPageIds.contains($0.sessionId) }
        if loadedPageCursors.isEmpty, !isLoadingMore, conversations.count <= Self.pageSize {
            nextCursor = page.nextCursor
            hasMore = page.hasMore
        }
        guard !loadedPageCursors.isEmpty else { return }
        let cursor = loadedPageCursors[refreshPageIndex % loadedPageCursors.count]
        refreshPageIndex = (refreshPageIndex + 1) % loadedPageCursors.count
        guard let background = try? await NuphosAPI.conversations(
            token: token, teamId: team.id, cursor: cursor, limit: Self.pageSize, scope: scope, search: search,
            archived: showArchived ? .only : .exclude, sort: sort
        ), generation == loadGeneration, !Task.isCancelled else { return }
        let fresh = Dictionary(background.conversations.map { ($0.sessionId, $0) }, uniquingKeysWith: { first, _ in first })
        conversations = conversations.map { fresh[$0.sessionId] ?? $0 }
    }

    /// Search is server-backed; debounce like the desktop (250 ms).
    private func scheduleSearch() {
        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await reload()
        }
    }
}
