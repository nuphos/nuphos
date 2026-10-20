package ai.nuphos.android.session

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.flow.first
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.ConversationReadApi
import ai.nuphos.android.data.ConversationActions
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.ConversationScope
import ai.nuphos.android.model.CredentialCatalog
import ai.nuphos.android.model.CredentialSelection
import ai.nuphos.android.model.PermissionMode
import ai.nuphos.android.model.Team
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ai.nuphos.android.model.CredentialDraft

class AgentStore(
    private val token: String,
    context: Context,
) {
    enum class Phase { Idle, Loading, Loaded, Failed }

    val pageSize = 30
    private val prefs = context.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE)

    var teams: List<Team> by mutableStateOf(emptyList())
        private set
    var teamsPhase: Phase by mutableStateOf(Phase.Idle)
        private set
    var workspaceRevision by mutableStateOf(0L)
        private set
    private var disposed = false
    private var membershipRequest = 0L
    var selectedTeam: Team? by mutableStateOf(null)
        private set

    var conversations: List<AgentConversation> by mutableStateOf(emptyList())
        private set
    var phase: Phase by mutableStateOf(Phase.Idle)
        private set
    var phaseError: String? by mutableStateOf(null)
        private set
    var isLoadingMore by mutableStateOf(false)
        private set
    var hasMore by mutableStateOf(false)
        private set
    private var nextCursor: String? = null
    private val historyObservations = mutableMapOf<Pair<String, String>, HistoryStatus.Observation>()
    var historyRevision by mutableStateOf(0)
        private set
    private fun observeHistory(rows: List<AgentConversation>, teamId: String, observedAt: Double) {
        rows.forEach { row ->
            val key = (row.teamId ?: teamId) to row.sessionId
            val next = HistoryStatus.observe(row, observedAt)
            if (historyObservations[key]?.accepts(next) != false) historyObservations[key] = next
        }
        historyRevision++
    }
    fun historyObservation(row: AgentConversation) = historyObservations[(row.teamId ?: selectedTeam?.id.orEmpty()) to row.sessionId]
    suspend fun markRead(teamId: String, sessionId: String, seq: Long) = ConversationReadApi.mark(token, teamId, sessionId, seq)
    fun applyRead(teamId: String, sessionId: String, seq: Long, state: ConversationReadApi.State) {
        if (!hasAiAccess() || selectedTeam?.id != teamId) return
        conversations = conversations.map { row ->
            if ((row.teamId ?: teamId) == teamId && row.sessionId == sessionId) HistoryStatus.mergeRead(row, seq, state.activitySeq, state.readSeq) else row
        }
    }

    var scope: ConversationScope by mutableStateOf(ConversationScope.Mine)
        private set
    var search by mutableStateOf("")
        private set

    var archivedOnly by mutableStateOf(false)
        private set
    var favorites by mutableStateOf<ConversationActions.Favorites?>(null)
        private set
    var favoritesError by mutableStateOf<String?>(null)
        private set

    private val favoritesRequests = PinnedHistory.Requests()
    var favoritesLoading by mutableStateOf(false)
        private set
    val pinnedShortcuts: List<PinnedHistory.Shortcut>
        get() = if (hasAiAccess()) PinnedHistory.shortcuts(favorites, search, archivedOnly) else emptyList()

    private fun clearFavorites() {
        favoritesRequests.invalidate()
        favorites = null
        favoritesError = null
        favoritesLoading = false
    }

    private val refreshRequests = HistoryRefresh()
    val isRefreshing get() = refreshRequests.running
    private var isReloading = false

    /** Work belongs to the store, rather than to the current composition. */
    fun refresh() {
        if (disposed || !hasAiAccess() || isRefreshing) return
        searchJob?.cancel()
        refreshRequests.start(storeScope) {
            if (selectedTeam == null) loadTeams()
            else kotlinx.coroutines.coroutineScope {
                launch { reload() }
                launch { loadFavorites() }
            }
        }
    }

    private fun resetHistory() {
        refreshRequests.invalidate()
        isReloading = false
        loadGeneration++
        conversations = emptyList()
        nextCursor = null
        hasMore = false
        isLoadingMore = false
        phase = Phase.Idle
        phaseError = null
        historyObservations.clear()
        historyRevision++
    }
    private fun mergeHistory(rows: List<AgentConversation>, teamId: String) = rows.map { incoming ->
        HistoryStatus.mergeList(incoming, conversations.firstOrNull {
            it.sessionId == incoming.sessionId && (it.teamId ?: teamId) == (incoming.teamId ?: teamId)
        }, teamId)
    }
    fun updateArchivedOnly(value: Boolean) {
        if (value == archivedOnly) return
        archivedOnly = value
        resetHistory()
        storeScope.launch { reload() }
    }
    suspend fun loadFavorites() {
        val team = selectedTeam ?: return
        if (!hasAiAccess()) return
        val ticket = favoritesRequests.begin(team.id)
        favoritesLoading = true
        try {
            val loaded = ConversationActions.favorites(token, team.id)
            if (!favoritesRequests.accepts(ticket, selectedTeam?.id, hasAiAccess())) return
            favorites = loaded
            favoritesError = null
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            if (favoritesRequests.accepts(ticket, selectedTeam?.id, hasAiAccess()))
                favoritesError = e.message ?: "Could not load pinned chats."
        } finally {
            if (favoritesRequests.accepts(ticket, selectedTeam?.id, hasAiAccess())) favoritesLoading = false
        }
    }
    suspend fun pin(session: ChatSession, pinned: Boolean) {
        require(hasAiAccess() && selectedTeam?.id == session.teamId && session.loaded && session.loadError == null)
        val ticket = favoritesRequests.begin(session.teamId)
        favoritesLoading = false
        val saved = ConversationActions.pin(token, session.teamId, session.sessionId, session.title, pinned)
        if (favoritesRequests.accepts(ticket, selectedTeam?.id, hasAiAccess())) { favorites = saved; favoritesError = null }
    }
    suspend fun rename(session: ChatSession, title: String) {
        require(session.canManage) { "Only the owner can rename this chat." }
        ConversationActions.rename(token, session.teamId, session.sessionId, title)
        session.reloadFromServer()
        reload()
    }
    suspend fun archive(session: ChatSession, archived: Boolean) {
        require(session.canManage) { "Only the owner can archive this chat." }
        ConversationActions.archive(token, session.teamId, session.sessionId, archived)
        session.reloadFromServer()
        reload()
    }

    var watchingSessionId: String? by mutableStateOf(null)
        private set
    var watchError: String? by mutableStateOf(null)
        private set
    fun clearWatchError() { watchError = null }
    fun canWatch(row: AgentConversation) = !disposed && hasAiAccess() && selectedTeam != null &&
        (row.teamId == null || row.teamId == selectedTeam?.id) && row.watching != null

    suspend fun setWatching(row: AgentConversation) {
        val team = selectedTeam?.id ?: return
        val current = conversations.firstOrNull { it.sessionId == row.sessionId && (it.teamId ?: team) == team } ?: return
        if (!canWatch(current) || current.watching != row.watching) return
        changeWatching(team, current.sessionId, !requireNotNull(current.watching))
    }
    suspend fun setWatching(session: ChatSession) {
        if (!session.canWatch || selectedTeam?.id != session.teamId) return
        changeWatching(session.teamId, session.sessionId, !requireNotNull(session.watching))
    }
    suspend fun refreshWatchState() {
        val team = selectedTeam?.id ?: return
        val revision = workspaceRevision
        reload()
        for (session in sessions.values.filter { it.teamId == team }.toList()) {
            if (disposed || !hasAiAccess() || selectedTeam?.id != team || workspaceRevision != revision) return
            try { session.refreshWatching() } catch (e: kotlinx.coroutines.CancellationException) { throw e
            } catch (_: Exception) {
                if (!disposed && hasAiAccess() && selectedTeam?.id == team && workspaceRevision == revision)
                    watchError = "Could not refresh watch status. Try again."
            }
        }
    }
    private suspend fun changeWatching(team: String, id: String, watching: Boolean) {
        if (disposed || !hasAiAccess() || watchingSessionId != null) return
        val revision = workspaceRevision
        fun current() = !disposed && hasAiAccess() && selectedTeam?.id == team && workspaceRevision == revision
        watchingSessionId = id
        watchError = null
        try {
            ConversationActions.watch(token, team, id, watching)
            if (!current()) return
            // DELETE cascades to unloaded descendants. Invalidate instead of guessing
            // ancestry from a partial page; only subsequent server reads restore it.
            loadGeneration++
            isLoadingMore = false
            conversations = conversations.map { it.copy(watching = null) }
            val affected = sessions.values.filter { it.teamId == team }.toList()
            affected.forEach { it.invalidateWatching() }
            reload()
            var refreshFailed = phaseError != null
            for (session in affected.filter { it.loaded && !it.browsingOnly }) {
                if (!current()) return
                try { session.refreshWatching() } catch (e: kotlinx.coroutines.CancellationException) { throw e
                } catch (_: Exception) { refreshFailed = true }
            }
            if (current() && refreshFailed) watchError = "Watch change saved, but status could not refresh. Refresh and try again."
        } catch (e: kotlinx.coroutines.CancellationException) { throw e
        } catch (e: Exception) {
            if (current()) watchError = "Could not update watch status. Refresh and try again."
        } finally {
            if (current()) watchingSessionId = null
        }
    }

    var unlinkingSessionId: String? by mutableStateOf(null)
        private set
    var unlinkError: String? by mutableStateOf(null)
        private set

    fun canUnlink(row: AgentConversation): Boolean =
        !disposed && hasAiAccess() && selectedTeam != null &&
            (row.teamId == null || row.teamId == selectedTeam?.id) &&
            row.isOwner == true && row.readOnly != true && !row.parentSessionId.isNullOrBlank()

    fun clearUnlinkError() { unlinkError = null }

    suspend fun unlinkParent(row: AgentConversation) {
        val teamId = selectedTeam?.id ?: return
        // Re-resolve the loaded row, rather than trusting a retained menu/confirmation.
        val current = conversations.firstOrNull { it.sessionId == row.sessionId && (it.teamId ?: teamId) == teamId } ?: return
        if (!canUnlink(current) || current.parentSessionId != row.parentSessionId || unlinkingSessionId != null) return
        val revision = workspaceRevision
        fun isCurrent() = !disposed && hasAiAccess() && workspaceRevision == revision && selectedTeam?.id == teamId
        unlinkingSessionId = current.sessionId
        unlinkError = null
        try {
            ConversationActions.unlinkParent(token, teamId, current.sessionId)
            if (!isCurrent()) return
            // Discard earlier reads so an old page cannot reattach the child. Keep all
            // loaded pages, pins, descendants and drafts; every tree section derives here.
            loadGeneration++
            isReloading = false
            isLoadingMore = false
            conversations = conversations.map {
                if (it.sessionId == current.sessionId && (it.teamId ?: teamId) == teamId) it.copy(parentSessionId = null) else it
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            if (isCurrent()) unlinkError = when {
                e is NuphosApi.Failure.Unauthorized -> "Your session has expired. Please sign in again."
                e is ai.nuphos.android.data.AgentChatApi.Conflict.Other && e.status in setOf(403, 404) ->
                    "This chat is unavailable or you no longer have permission to unlink it."
                else -> "Could not unlink chat. Try again."
            }
        } finally {
            if (isCurrent()) unlinkingSessionId = null
        }
    }

    private var credentials by mutableStateOf(CredentialDraft())
    val credentialCatalog: CredentialCatalog? get() = credentials.catalog
    val credentialCatalogError: String? get() = credentials.error
    val credentialsReady: Boolean get() = !disposed && hasAiAccess() && credentials.isReady
    val credentialSelection: CredentialSelection get() = credentials.selection
    var permissionMode by mutableStateOf(
        PermissionMode.from(prefs.getString(PERMISSION_KEY, null)),
    )
        private set
    var pendingPrompt: ai.nuphos.android.model.ComposerSubmission? = null

    private val storeScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var searchJob: Job? = null
    private var loadGeneration = 0
    private data class SessionKey(val teamId: String, val sessionId: String)
    private val sessions = mutableMapOf<SessionKey, ChatSession>()
    private val hasAiAccess = AiAccess.bind(token)

    init {
        // Work outlives the view. Clean it only when its account capability expires.
        storeScope.launch {
            snapshotFlow { hasAiAccess() }.first { !it }
            disposeForConsent()
        }
    }

    fun updateScope(value: ConversationScope) {
        if (value == scope) return
        scope = value
        resetHistory()
        storeScope.launch { reload() }
    }

    fun updateSearch(value: String) {
        if (value == search) return
        search = value
        resetHistory()
        searchJob?.cancel()
        searchJob = storeScope.launch {
            delay(250)
            reload()
        }
    }

    fun updatePermissionMode(mode: PermissionMode) {
        permissionMode = mode
        prefs.edit().putString(PERMISSION_KEY, mode.raw).apply()
    }

    fun updateCredentialSelection(selection: CredentialSelection) {
        if (disposed || !hasAiAccess() || selectedTeam == null) return
        credentials = credentials.copy(selection = selection.copy(newConversation = true))
    }

    suspend fun loadCredentialOptions(force: Boolean = false) {
        if (disposed || !hasAiAccess()) return
        val team = selectedTeam ?: return
        if (!force && credentialCatalog != null) return
        credentials = credentials.begin()
        val request = credentials.request
        val revision = workspaceRevision
        fun isCurrent() = !disposed && hasAiAccess() && selectedTeam?.id == team.id && workspaceRevision == revision
        try {
            val catalog = NuphosApi.credentialOptions(token, team.id, forNewConversation = true)
            if (isCurrent()) credentials = credentials.finish(request, Result.success(catalog))
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            if (isCurrent()) credentials = credentials.finish(request, Result.failure(e))
        }
    }

    suspend fun loadTeams(onExpired: () -> Unit = {}) {
        if (disposed || !hasAiAccess()) return
        val request = ++membershipRequest
        teamsPhase = Phase.Loading
        try {
            val loaded = ai.nuphos.android.data.WorkspaceApi(token).memberships()
            if (disposed || !hasAiAccess() || request != membershipRequest) return
            teams = loaded
            teamsPhase = Phase.Loaded
            val remembered = prefs.getString(LAST_TEAM_KEY, null)
            val pick = loaded.firstOrNull { it.id == remembered } ?: loaded.firstOrNull()
            if (pick != selectedTeam) {
                workspaceRevision++
                watchingSessionId = null
                watchError = null
                unlinkingSessionId = null
                unlinkError = null
                selectedTeam = pick
                resetHistory()
                clearFavorites()
                credentials = credentials.reset()
                reload()
            } else if (phase == Phase.Idle) {
                reload()
            }
        } catch (e: Exception) {
            if (disposed || !hasAiAccess() || request != membershipRequest) return
            if (e is NuphosApi.Failure.Unauthorized) onExpired()
            teamsPhase = Phase.Failed
            phaseError = e.message
            if (teams.isEmpty()) {
                phase = Phase.Failed
            }
        }
    }

    fun acceptMemberships(saved: List<Team>, selectId: String? = null): Boolean {
        if (disposed || !hasAiAccess()) return false
        val verified = selectId?.let { id -> saved.firstOrNull { it.id == id } ?: return false }
        membershipRequest++
        teams = saved
        teamsPhase = Phase.Loaded
        selectedTeam?.let { old ->
            val refreshed = saved.firstOrNull { it.id == old.id }
            if (refreshed == null) {
                workspaceRevision++
                watchingSessionId = null
                watchError = null
                unlinkingSessionId = null
                unlinkError = null
                selectedTeam = null
                resetHistory()
                clearFavorites()
                credentials = credentials.reset()
            } else {
                if (refreshed != old) {
                    credentials = credentials.reset()
                    workspaceRevision++
                    watchingSessionId = null
                    watchError = null
                    unlinkingSessionId = null
                    unlinkError = null
                }
                selectedTeam = refreshed
            }
        }
        if (verified != null) select(verified)
        return true
    }

    fun select(team: Team) {
        if (disposed || !hasAiAccess()) return
        val verified = teams.firstOrNull { it.id == team.id } ?: return
        if (verified == selectedTeam) return
        workspaceRevision++
        watchingSessionId = null
        watchError = null
        unlinkingSessionId = null
        unlinkError = null
        membershipRequest++
        selectedTeam = verified
        resetHistory()
        clearFavorites()
        prefs.edit().putString(LAST_TEAM_KEY, team.id).apply()
        credentials = credentials.reset()
        storeScope.launch { reload() }
    }

    /** Fresh, read-only catalog for composer suggestions; never prune or persist IAM here. */
    suspend fun mentionableComputers(teamId: String): List<CredentialCatalog.Item> {
        if (!hasAiAccess() || disposed || selectedTeam?.id != teamId) return emptyList()
        val revision = workspaceRevision
        val catalog = NuphosApi.credentialOptions(token, teamId)
        if (!hasAiAccess() || disposed || selectedTeam?.id != teamId || workspaceRevision != revision) return emptyList()
        return catalog.allItems.filter { it.provider.optionsKey == "devices" }
    }

    /** Same bounded scope=mine search as iOS, independent of history filters. */
    suspend fun mentionableSessions(teamId: String, query: String): List<AgentConversation> {
        if (!hasAiAccess() || selectedTeam?.id != teamId) return emptyList()
        val page = NuphosApi.conversations(token = token, teamId = teamId, limit = 6,
            scope = ConversationScope.Mine, search = query)
        if (!hasAiAccess() || selectedTeam?.id != teamId) return emptyList()
        return page.conversations
    }

    suspend fun reload() {
        if (disposed || !hasAiAccess()) return
        val team = selectedTeam
        if (team == null) {
            resetHistory()
            if (teamsPhase == Phase.Loaded) phase = Phase.Loaded
            return
        }
        loadGeneration += 1
        isLoadingMore = false
        val generation = loadGeneration
        val workspace = workspaceRevision
        isReloading = true
        val hasLoadedHistory = phase == Phase.Loaded || conversations.isNotEmpty()
        if (!hasLoadedHistory) phase = Phase.Loading
        try {
            val observedAt = RuntimeObservation.now()
            val page = NuphosApi.conversations(
                token = token,
                teamId = team.id,
                limit = pageSize,
                scope = scope,
                search = search,
                archivedOnly = archivedOnly,
            )
            if (generation != loadGeneration || selectedTeam?.id != team.id || workspace != workspaceRevision || disposed || !hasAiAccess()) return
            observeHistory(page.conversations, team.id, observedAt)
            conversations = mergeHistory(page.conversations, team.id)
            nextCursor = page.nextCursor
            hasMore = page.hasMore
            phase = Phase.Loaded
            phaseError = null
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            if (generation != loadGeneration || selectedTeam?.id != team.id || workspace != workspaceRevision || disposed || !hasAiAccess()) return
            phase = if (hasLoadedHistory) Phase.Loaded else Phase.Failed
            phaseError = e.message
        } finally {
            if (generation == loadGeneration) {
                isReloading = false
                if (phase == Phase.Loading) {
                    phase = if (hasLoadedHistory) Phase.Loaded else Phase.Failed
                    if (!hasLoadedHistory) phaseError = "Chat refresh was interrupted. Try again."
                }
            }
        }
    }

    suspend fun loadMore() {
        val team = selectedTeam
        val cursor = nextCursor
        if (disposed || !hasAiAccess() || isRefreshing || isReloading || phase != Phase.Loaded || !hasMore || isLoadingMore || team == null || cursor == null) return
        isLoadingMore = true
        val generation = loadGeneration
        val workspace = workspaceRevision
        try {
            val observedAt = RuntimeObservation.now()
            val page = NuphosApi.conversations(
                token = token,
                teamId = team.id,
                cursor = cursor,
                limit = pageSize,
                scope = scope,
                search = search,
                archivedOnly = archivedOnly,
            )
            if (generation != loadGeneration || selectedTeam?.id != team.id || workspace != workspaceRevision || disposed || !hasAiAccess()) return
            observeHistory(page.conversations, team.id, observedAt)
            val merged = mergeHistory(page.conversations, team.id)
            val seen = conversations.map { it.sessionId }.toSet()
            conversations = conversations.map { current ->
                merged.firstOrNull { it.sessionId == current.sessionId && (it.teamId ?: team.id) == (current.teamId ?: team.id) } ?: current
            } + merged.filter { it.sessionId !in seen }
            nextCursor = page.nextCursor
            hasMore = page.hasMore
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            // Leave what we have.
        } finally {
            if (generation == loadGeneration) isLoadingMore = false
        }
    }

    fun session(forConversation: AgentConversation): ChatSession {
        return sessions.getOrPut(SessionKey(forConversation.teamId ?: selectedTeam?.id.orEmpty(), forConversation.sessionId)) {
            ChatSession(
                token = token,
                teamId = forConversation.teamId ?: selectedTeam?.id.orEmpty(),
                sessionId = forConversation.sessionId,
                title = forConversation.displayTitle,
            )
        }
    }

    fun session(sessionId: String, title: String): ChatSession {
        return sessions.getOrPut(SessionKey(selectedTeam?.id.orEmpty(), sessionId)) {
            ChatSession(
                token = token,
                teamId = selectedTeam?.id.orEmpty(),
                sessionId = sessionId,
                title = title,
            )
        }
    }

    fun newSession(selection: RuntimeSelections.Selection? = null): ChatSession? {
        if (!credentialsReady) return null
        val team = selectedTeam ?: return null
        if (selection != null && (!selection.valid || selection.teamId != team.id || selection.reselectionRequired)) return null
        val session = ChatSession.fresh(token, team.id, selection?.binding)
        session.presetPermissionMode(permissionMode)
        session.credentialAccess = credentialSelection
        sessions[SessionKey(team.id, session.sessionId)] = session
        return session
    }

    fun disposeForConsent() {
        disposed = true
        credentials = credentials.reset()
        membershipRequest++
        workspaceRevision++
        watchingSessionId = null
        watchError = null
        unlinkingSessionId = null
        unlinkError = null
        resetHistory()
        clearFavorites()
        storeScope.coroutineContext[Job]?.cancel()
        sessions.values.forEach { it.disposeForConsent() }
        sessions.clear()
        pendingPrompt?.attachments?.forEach { it.releaseOwnedCopy() }
        pendingPrompt = null
    }

    companion object {
        private const val LAST_TEAM_KEY = "nuphos.workspace.lastTeamId"
        private const val PERMISSION_KEY = "nuphos.agentPermissionMode"
    }
}
