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
import kotlinx.serialization.json.Json

class AgentStore(
    private val token: String,
    context: Context,
) {
    enum class Phase { Idle, Loading, Loaded, Failed }

    val pageSize = 30
    private val prefs = context.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

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

    private fun resetHistory() {
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

    var credentialCatalog: CredentialCatalog? by mutableStateOf(null)
        private set
    var credentialCatalogError: String? by mutableStateOf(null)
        private set
    var credentialSelection by mutableStateOf(CredentialSelection())
        private set
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
        credentialSelection = selection
        persistCredentialSelection()
    }

    suspend fun loadCredentialOptions(force: Boolean = false) {
        val team = selectedTeam ?: return
        if (!force && credentialCatalog != null) return
        try {
            val catalog = NuphosApi.credentialOptions(token, team.id)
            credentialCatalog = catalog
            credentialCatalogError = null
            credentialSelection = credentialSelection.pruned(catalog)
        } catch (e: Exception) {
            credentialCatalogError = e.message
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
                selectedTeam = pick
                resetHistory()
                clearFavorites()
                credentialCatalog = null
                restoreCredentialSelection()
                reload()
            } else if (phase == Phase.Idle) {
                restoreCredentialSelection()
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
                selectedTeam = null
                resetHistory()
                clearFavorites()
                credentialCatalog = null
                restoreCredentialSelection()
            } else {
                if (refreshed != old) workspaceRevision++
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
        membershipRequest++
        selectedTeam = verified
        resetHistory()
        clearFavorites()
        prefs.edit().putString(LAST_TEAM_KEY, team.id).apply()
        credentialCatalog = null
        restoreCredentialSelection()
        storeScope.launch { reload() }
    }

    suspend fun reload() {
        val team = selectedTeam
        if (team == null) {
            resetHistory()
            if (teamsPhase == Phase.Loaded) phase = Phase.Loaded
            return
        }
        loadGeneration += 1
        isLoadingMore = false
        val generation = loadGeneration
        val hasLoadedHistory = phase == Phase.Loaded || conversations.isNotEmpty()
        if (conversations.isEmpty()) phase = Phase.Loading
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
            if (generation != loadGeneration || selectedTeam?.id != team.id || !hasAiAccess()) return
            observeHistory(page.conversations, team.id, observedAt)
            conversations = mergeHistory(page.conversations, team.id)
            nextCursor = page.nextCursor
            hasMore = page.hasMore
            phase = Phase.Loaded
            phaseError = null
        } catch (e: Exception) {
            if (generation != loadGeneration || selectedTeam?.id != team.id || !hasAiAccess()) return
            phase = if (hasLoadedHistory) Phase.Loaded else Phase.Failed
            phaseError = e.message
        }
    }

    suspend fun loadMore() {
        val team = selectedTeam
        val cursor = nextCursor
        if (!hasMore || isLoadingMore || team == null || cursor == null) return
        isLoadingMore = true
        val generation = loadGeneration
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
            if (generation != loadGeneration || selectedTeam?.id != team.id || !hasAiAccess()) return
            observeHistory(page.conversations, team.id, observedAt)
            val merged = mergeHistory(page.conversations, team.id)
            val seen = conversations.map { it.sessionId }.toSet()
            conversations = conversations.map { current ->
                merged.firstOrNull { it.sessionId == current.sessionId && (it.teamId ?: team.id) == (current.teamId ?: team.id) } ?: current
            } + merged.filter { it.sessionId !in seen }
            nextCursor = page.nextCursor
            hasMore = page.hasMore
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
        val team = selectedTeam ?: return null
        if (selection != null && (!selection.valid || selection.teamId != team.id || selection.reselectionRequired)) return null
        val session = ChatSession.fresh(token, team.id, selection?.binding)
        session.presetPermissionMode(permissionMode)
        session.credentialAccess = if (credentialSelection.isEmpty) null else credentialSelection
        sessions[SessionKey(team.id, session.sessionId)] = session
        return session
    }

    fun disposeForConsent() {
        disposed = true
        membershipRequest++
        workspaceRevision++
        resetHistory()
        clearFavorites()
        storeScope.coroutineContext[Job]?.cancel()
        sessions.values.forEach { it.disposeForConsent() }
        sessions.clear()
        pendingPrompt?.attachments?.forEach { it.releaseOwnedCopy() }
        pendingPrompt = null
    }

    private fun restoreCredentialSelection() {
        val team = selectedTeam
        if (team == null) {
            credentialSelection = CredentialSelection()
            return
        }
        val raw = prefs.getString(credentialKey(team), null)
        credentialSelection = if (raw != null) {
            runCatching { json.decodeFromString(CredentialSelection.serializer(), raw) }
                .getOrDefault(CredentialSelection())
        } else {
            CredentialSelection()
        }
    }

    private fun persistCredentialSelection() {
        val team = selectedTeam ?: return
        val raw = json.encodeToString(CredentialSelection.serializer(), credentialSelection)
        prefs.edit().putString(credentialKey(team), raw).apply()
    }

    private fun credentialKey(team: Team) = "nuphos.credentialSelection.${team.id}"

    companion object {
        private const val LAST_TEAM_KEY = "nuphos.workspace.lastTeamId"
        private const val PERMISSION_KEY = "nuphos.agentPermissionMode"
    }
}
