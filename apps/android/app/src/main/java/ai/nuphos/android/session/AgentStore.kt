package ai.nuphos.android.session

import kotlinx.coroutines.ensureActive

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.flow.first
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.BotActions
import ai.nuphos.android.data.ConversationReadApi
import ai.nuphos.android.data.ConversationActions
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.BotFaces
import ai.nuphos.android.model.botsList
import ai.nuphos.android.model.ConversationScope
import ai.nuphos.android.model.CredentialCatalog
import ai.nuphos.android.model.CredentialSelection
import ai.nuphos.android.model.PermissionMode
import ai.nuphos.android.model.Team
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
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
    /** Reads `historyRevision` so a row redraws when a fresh observation arrives with otherwise identical data. */
    fun historyObservation(row: AgentConversation): HistoryStatus.Observation? {
        historyRevision
        return historyObservations[(row.teamId ?: selectedTeam?.id.orEmpty()) to row.sessionId]
    }
    suspend fun markRead(teamId: String, sessionId: String, seq: Long) = ConversationReadApi.mark(token, teamId, sessionId, seq)
    fun applyRead(teamId: String, sessionId: String, seq: Long, state: ConversationReadApi.State) {
        if (!hasAiAccess() || selectedTeam?.id != teamId) return
        conversations = conversations.map { row ->
            if ((row.teamId ?: teamId) == teamId && row.sessionId == sessionId) HistoryStatus.mergeRead(row, seq, state.activitySeq, state.readSeq) else row
        }
    }

    var search by mutableStateOf("")
        private set

    var favorites by mutableStateOf<ConversationActions.Favorites?>(null)
        private set
    var favoritesError by mutableStateOf<String?>(null)
        private set

    private val favoritesRequests = PinnedHistory.Requests()
    var favoritesLoading by mutableStateOf(false)
        private set
    val pinnedShortcuts: List<PinnedHistory.Shortcut>
        get() = if (hasAiAccess()) PinnedHistory.shortcuts(favorites, search) else emptyList()

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
        // Unlike a list poll, a refresh reads runtimes again: one added elsewhere replaces the prompt.
        if (selectedTeam != null) refreshRuntimes()
        refreshRequests.start(storeScope) {
            if (selectedTeam == null) loadTeams()
            else kotlinx.coroutines.coroutineScope {
                launch { reload() }
                launch { loadFavorites() }
                launch { loadChannels() }
            }
        }
    }

    fun refreshOnResume() {
        if (disposed || !hasAiAccess() || selectedTeam == null) return
        // A read started before leaving may predate changes made on another client.
        refreshRequests.invalidate()
        refresh()
    }

    // MARK: Runtimes: whether the workspace has any, for the first-runtime prompt.
    /** Null until a listing for this workspace answers. A failed one says nothing, so the last answer stays. */
    var hasRuntimes by mutableStateOf<Boolean?>(null)
        private set
    private var runtimesGeneration = 0
    private var runtimesListedFor: Long? = null

    fun refreshRuntimes() = listRuntimes(force = true)
    private fun listRuntimes(force: Boolean) {
        if (disposed || !hasAiAccess()) return
        val team = selectedTeam ?: return
        if (!force && runtimesListedFor == workspaceRevision) return
        runtimesListedFor = workspaceRevision
        val generation = ++runtimesGeneration
        val workspace = workspaceRevision
        val consent = AiAccess.revision
        storeScope.launch {
            val any = try { ai.nuphos.android.data.AgentRuntimeApi(token, team.id).catalog().isNotEmpty() }
                catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { null }
            if (any != null && !disposed && hasAiAccess() && AiAccess.revision == consent && selectedTeam?.id == team.id &&
                workspaceRevision == workspace && generation == runtimesGeneration) hasRuntimes = any
        }
    }

    // MARK: Chats (channels): their own listing, as on iOS and Desktop.
    var channels by mutableStateOf<List<AgentConversation>>(emptyList())
        private set
    var channelsLoaded by mutableStateOf(false)
        private set
    private var channelGeneration = 0

    /** The Bots page: every chat, and each Bot without one yet. */
    val botsList: List<AgentConversation> get() = botsList(channels, conversations)

    var openingBotId by mutableStateOf<String?>(null)
        private set
    var botChatError by mutableStateOf<String?>(null)
        private set
    /** The Bot [botChatError] is about, so trying again means that Bot and not the last row tapped. */
    var botChatFailedId by mutableStateOf<String?>(null)
        private set
    fun clearBotChatError() { botChatError = null; botChatFailedId = null }
    /** Chats made for a Bot that didn't get added, so trying again doesn't leave another empty chat. */
    private val unfinishedBotChats = mutableMapOf<String, String>()

    /** Makes a Bot's chat, or finishes one that didn't get the Bot added. Null if the workspace moved on. */
    private suspend fun makeBotChat(team: String, botId: String, current: () -> Boolean): String? {
        val chat = unfinishedBotChats[botId] ?: BotActions.createChannel(token, team)
        if (!current()) return null
        unfinishedBotChats[botId] = chat
        BotActions.addBot(token, team, chat, botId)
        if (!current()) return null
        unfinishedBotChats.remove(botId)
        loadChannels()
        return chat.takeIf { current() }
    }

    /** A Bot's 1:1 chat, made the first time. Null when it couldn't be made or the workspace moved on. */
    suspend fun openBotChat(botId: String): String? {
        channels.firstOrNull { it.botId == botId }?.let { return it.sessionId }
        val team = selectedTeam?.id ?: return null
        if (disposed || !hasAiAccess() || openingBotId != null || creatingBot) return null
        val workspace = workspaceRevision
        val consent = AiAccess.revision
        fun current() = !disposed && hasAiAccess() && AiAccess.revision == consent &&
            selectedTeam?.id == team && workspaceRevision == workspace
        openingBotId = botId
        clearBotChatError()
        try {
            return makeBotChat(team, botId, ::current)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            if (current()) { botChatError = "Couldn't open this Bot. Try again."; botChatFailedId = botId }
            return null
        } finally {
            if (workspaceRevision == workspace) openingBotId = null
        }
    }

    var creatingBot by mutableStateOf(false)
        private set
    var newBotError by mutableStateOf<String?>(null)
        private set
    /** A new Bot whose chat couldn't be made, so trying again doesn't make a second Bot. */
    var newBotWaitingForChat by mutableStateOf<String?>(null)
        private set
    /** The New Bot sheet was closed: anything it left waiting is now just a Bot on the list. */
    fun forgetNewBot() { newBotError = null; newBotWaitingForChat = null }

    /** "+" on Bots: the Bot with the picked name and face, then its 1:1 chat. Null if either didn't happen. */
    suspend fun createBot(title: String, avatar: String, runtime: ai.nuphos.android.data.RuntimeBinding? = null): String? {
        val team = selectedTeam?.id ?: return null
        if (disposed || !hasAiAccess() || creatingBot || openingBotId != null) return null
        val workspace = workspaceRevision
        val consent = AiAccess.revision
        fun current() = !disposed && hasAiAccess() && AiAccess.revision == consent &&
            selectedTeam?.id == team && workspaceRevision == workspace
        creatingBot = true
        newBotError = null
        try {
            // A Bot with no runtime to run on would take posts and never answer, without saying why.
            if (newBotWaitingForChat == null && runtime == null) {
                val runtimes = ai.nuphos.android.data.AgentRuntimeApi(token, team).catalog()
                // The workspace or consent may have changed while the list loaded: nothing is created for the old one.
                kotlinx.coroutines.currentCoroutineContext().ensureActive()
                if (!current()) return null
                if (runtimes.isEmpty()) {
                    newBotError = "This workspace has no runtime yet. Add one on the Runtimes page, then create your Bot."
                    return null
                }
            }
            val bot = newBotWaitingForChat ?: BotActions.create(token, team, title, avatar,
                runtime?.runtimeId, runtime?.agentRuntime, runtime?.displayLabel)
            if (!current()) return null
            newBotWaitingForChat = bot
            BotFaces.learn(bot, avatar)
            reload()
            if (!current()) return null
            val chat = makeBotChat(team, bot, ::current) ?: return null
            newBotWaitingForChat = null
            return chat
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            if (current()) newBotError = if (newBotWaitingForChat != null) "The Bot was created, but its chat didn't open. Try again."
                else "Couldn't create this Bot. Try again."
            return null
        } finally {
            if (workspaceRevision == workspace) creatingBot = false
        }
    }

    private fun rememberHasChats() {
        if (search.isEmpty()) prefs.edit().putBoolean(HAS_CHATS_KEY, botsList.isNotEmpty()).apply()
    }

    /** Whether the last listing had a chat or a Bot, so launch can open on Bots before it loads. */
    val rememberedHasChats: Boolean get() = prefs.getBoolean(HAS_CHATS_KEY, false)

    suspend fun loadChannels() {
        if (disposed || !hasAiAccess()) return
        val team = selectedTeam ?: return
        val generation = ++channelGeneration
        val query = search
        val workspace = workspaceRevision
        val consent = AiAccess.revision
        fun current() = !disposed && hasAiAccess() && AiAccess.revision == consent && selectedTeam?.id == team.id &&
            workspaceRevision == workspace && generation == channelGeneration
        try {
            val rows = kotlinx.coroutines.coroutineScope {
                listOf(ConversationScope.Mine, ConversationScope.Shared).map { scope ->
                    async { NuphosApi.conversations(token, team.id, limit = 100, scope = scope, search = query, channels = true).rows }
                }.flatMap { it.await() }
            }
            if (!current()) return
            // A listing only ever shows chats; an agent row from an older server is left out.
            channels = rows.filter { it.isChannel && (it.teamId ?: team.id) == team.id }
                .distinctBy { it.sessionId }.sortedByDescending { it.lastActiveAt }.map(::withLocalRead)
            BotFaces.learn(channels)
            channelsLoaded = true
            // The Bots without a chat come from the history, so its absence says nothing yet.
            if (phase == Phase.Loaded) rememberHasChats()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            // Keep what was shown; the next refresh tries again.
        }
    }

    fun channel(sessionId: String): AgentConversation? = channels.firstOrNull { it.sessionId == sessionId }

    /** What this device has marked read, so a listing already on its way cannot bring a chat's dot back. */
    private val channelReads = mutableMapOf<String, Long>()

    private fun withLocalRead(row: AgentConversation): AgentConversation {
        val read = channelReads[row.sessionId] ?: return row
        val activity = HistoryStatus.sequence(row.activitySeq) ?: return row
        if ((HistoryStatus.sequence(row.readSeq) ?: 0) >= read) return row
        return row.copy(readSeq = ai.nuphos.android.data.JsonValue.Number(read.toDouble()), unread = ai.nuphos.android.data.JsonValue.Bool(activity > read))
    }

    /** Marks an open chat read; its row shows as read at once, not only after the next listing. */
    suspend fun markChannelRead(teamId: String, sessionId: String, seq: Long) {
        if (disposed || !hasAiAccess() || selectedTeam?.id != teamId) return
        val state = markRead(teamId, sessionId, seq)
        if (disposed || !hasAiAccess() || selectedTeam?.id != teamId) return
        channelReads[sessionId] = maxOf(channelReads[sessionId] ?: 0, minOf(seq, state.readSeq))
        channels = channels.map { if (it.sessionId == sessionId) withLocalRead(it) else it }
    }

    /** The runtime state the last checks found for agents in an open chat. An agent not checked yet has no entry. */
    private var agentTurns by mutableStateOf<Map<String, JsonValue>>(emptyMap())

    /** The agent is in a turn that answers this chat; a turn about anything else shows no dots there. */
    fun typingIn(sessionId: String, channelId: String): Boolean = RuntimeObservation.typingIn(
        agentTurns[sessionId] ?: conversations.firstOrNull { it.sessionId == sessionId }?.runtimeState, channelId)

    /**
     * Asks each agent in an open chat whether it is in a turn. The agent list is one page of many
     * and is left as it is. An agent that can't be read keeps what was last known.
     */
    suspend fun loadAgentTurns(sessionIds: List<String>) {
        val team = selectedTeam ?: return
        val workspace = workspaceRevision
        for (id in sessionIds) {
            if (disposed || !hasAiAccess() || selectedTeam?.id != team.id || workspace != workspaceRevision) return
            try {
                val state = NuphosApi.conversationDetail(token, team.id, id, tail = 1).runtimeState ?: JsonValue.obj()
                if (disposed || !hasAiAccess() || selectedTeam?.id != team.id || workspace != workspaceRevision) return
                agentTurns = agentTurns + (id to state)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (_: Exception) {
                // Keep what was shown; the next check tries again.
            }
        }
    }

    private val channelSessions = mutableMapOf<Pair<String, String>, ChannelSession>()

    /** One chat session per workspace and chat, dropped with the workspace. */
    fun channelSession(sessionId: String, title: String? = null): ChannelSession? {
        val team = selectedTeam ?: return null
        if (disposed || !hasAiAccess()) return null
        return channelSessions.getOrPut(team.id to sessionId) {
            ChannelSession(team.id, sessionId, title ?: channel(sessionId)?.displayTitle ?: "Chat",
                ChannelSession.Api(token, team.id, sessionId))
                // The list row's icon shows at once; the chat's own load keeps it current.
                .also { it.faces = channel(sessionId)?.faces.orEmpty() }
        }
    }

    private fun resetHistory() {
        runtimesGeneration++
        runtimesListedFor = null
        hasRuntimes = null
        channelGeneration++
        channels = emptyList()
        channelsLoaded = false
        unfinishedBotChats.clear()
        openingBotId = null
        clearBotChatError()
        creatingBot = false
        forgetNewBot()
        channelSessions.clear()
        channelReads.clear()
        agentTurns = emptyMap()
        searchJob?.cancel()
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
    fun foldedThreadIds(accountId: String?, teamId: String?): Set<String> {
        if (accountId == null || teamId == null) return emptySet()
        return prefs.getStringSet("agent.folded.$accountId.$teamId", emptySet()).orEmpty().toSet()
    }
    fun saveFoldedThreadIds(accountId: String?, teamId: String?, ids: Set<String>) {
        if (accountId == null || teamId == null || selectedTeam?.id != teamId || !hasAiAccess()) return
        prefs.edit().putStringSet("agent.folded.$accountId.$teamId", ids.toSet()).apply()
    }
    private class PinnedHistoryOwner(val teamId: String, val generation: Int, val workspace: Long)
    private var pinnedHistoryOwner by mutableStateOf<PinnedHistoryOwner?>(null)
    val loadingPinnedHistory: Boolean
        get() = pinnedHistoryOwner?.let {
            it.teamId == selectedTeam?.id && it.generation == loadGeneration && it.workspace == workspaceRevision
        } == true
    private suspend fun loadMissingPinnedHistory() {

        if (loadingPinnedHistory || phase != Phase.Loaded || isReloading || search.isNotEmpty()) return
        val teamId = selectedTeam?.id ?: return
        val generation = loadGeneration
        val workspace = workspaceRevision
        val owner = PinnedHistoryOwner(teamId, generation, workspace)
        pinnedHistoryOwner = owner
        try {
            // Pins can predate hundreds of rows. Stop on resolved pins or server
            // exhaustion, not an arbitrary page count; reject repeated cursors.
            val visitedCursors = mutableSetOf<String>()
            while (true) {
                if (disposed || !hasAiAccess() || selectedTeam?.id != teamId || generation != loadGeneration || workspace != workspaceRevision || search.isNotEmpty() || !hasMore || isLoadingMore) return
                val loaded = conversations.map { it.sessionId }.toSet()
                if (pinnedShortcuts.all { it.sessionId in loaded }) return
                val before = nextCursor ?: return
                if (!visitedCursors.add(before)) return
                kotlinx.coroutines.currentCoroutineContext().ensureActive()
                loadMore(allowDuringRefresh = true)

                if (nextCursor == before) return
            }
        } finally {
            // A held request from an earlier scope must not clear the latest owner.
            if (pinnedHistoryOwner === owner) pinnedHistoryOwner = null
        }
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
            loadMissingPinnedHistory()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            if (favoritesRequests.accepts(ticket, selectedTeam?.id, hasAiAccess()))
                favoritesError = e.message ?: "Could not load pinned agents."
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
        require(session.canManage) { "Only the owner can rename this agent." }
        ConversationActions.rename(token, session.teamId, session.sessionId, title)
        session.reloadFromServer()
        reload()
    }
    suspend fun archive(session: ChatSession, archived: Boolean) {
        require(session.canManage) { "Only the owner can archive this agent." }
        ConversationActions.archive(token, session.teamId, session.sessionId, archived)
        session.reloadFromServer()
        reload()
    }

    var rowActionSessionId: String? by mutableStateOf(null)
        private set
    var rowActionError: String? by mutableStateOf(null)
        private set
    fun clearRowActionError() { rowActionError = null }
    fun canPin(row: AgentConversation) = currentActionRow(row) != null && favorites != null && !favoritesLoading
    fun canArchive(row: AgentConversation) = currentActionRow(row)?.let {
        (it.canManage ?: (it.isOwner == true)) && it.readOnly != true
    } == true

    fun canRename(row: AgentConversation) = canArchive(row)

    suspend fun rename(row: AgentConversation, title: String): Boolean {
        val current = currentActionRow(row) ?: return false
        val team = selectedTeam?.id ?: return false
        if (!canRename(current) || rowActionSessionId != null) return false
        val workspace = workspaceRevision
        val consent = AiAccess.revision
        fun valid() = !disposed && hasAiAccess() && AiAccess.revision == consent &&
            selectedTeam?.id == team && workspaceRevision == workspace && canRename(row)
        rowActionSessionId = current.sessionId
        rowActionError = null
        try {
            val validTitle = requireNotNull(ConversationActions.validTitle(title)) { "Title must contain 1–120 characters." }
            val detail = NuphosApi.conversationDetail(token, team, current.sessionId)
            if (!valid()) return false
            require(detail.readOnly != true && (detail.canManage ?: (detail.isOwner == true))) { "Only the owner can rename this agent." }
            ConversationActions.rename(token, team, current.sessionId, validTitle)
            if (!valid()) return false
            val confirmed = NuphosApi.conversationDetail(token, team, current.sessionId)
            if (!valid()) return false
            require(confirmed.title == validTitle) { "The updated title could not be confirmed. Refresh and try again." }
            conversations = conversations.map { if (it.sessionId == current.sessionId && (it.teamId ?: team) == team) it.copy(title = confirmed.title) else it }
            sessions[SessionKey(team, current.sessionId)]?.applyConfirmedTitle(validTitle)
            return true
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            if (valid()) rowActionError = e.message ?: "Could not rename this agent. Try again."
            return false
        } finally {
            if (workspaceRevision == workspace) rowActionSessionId = null
        }
    }

    private fun currentActionRow(row: AgentConversation): AgentConversation? {
        val team = selectedTeam?.id ?: return null
        if (disposed || !hasAiAccess() || (row.teamId != null && row.teamId != team)) return null
        return conversations.firstOrNull { it.sessionId == row.sessionId && (it.teamId ?: team) == team }
    }

    /** Read fresh server metadata without opening a chat or resuming its active turn. */
    private suspend fun rowAction(row: AgentConversation, archive: Boolean?, pinned: Boolean?) {
        val current = currentActionRow(row) ?: return
        val team = selectedTeam?.id ?: return
        if (rowActionSessionId != null || (pinned != null && !canPin(current)) ||
            (archive != null && (!canArchive(current) || current.isArchived != row.isArchived))) return
        val revision = workspaceRevision
        fun valid() = !disposed && hasAiAccess() && selectedTeam?.id == team && workspaceRevision == revision && currentActionRow(row) != null
        rowActionSessionId = current.sessionId
        rowActionError = null
        try {
            val detail = NuphosApi.conversationDetail(token, team, current.sessionId)
            if (!valid()) return
            if (archive != null) {
                require(detail.readOnly != true && (detail.canManage ?: (detail.isOwner == true)))
                // A retained confirmation must not invert a concurrently changed archive state.
                require((detail.archivedAt != null) == row.isArchived)
                ConversationActions.archive(token, team, current.sessionId, archive)
                if (valid()) reload()
            } else if (pinned != null) {
                if (!canPin(current)) return
                val ticket = favoritesRequests.begin(team)
                val saved = ConversationActions.pin(token, team, current.sessionId, detail.title ?: current.displayTitle, pinned)
                if (valid() && favoritesRequests.accepts(ticket, selectedTeam?.id, hasAiAccess())) {
                    favorites = saved
                    favoritesError = null
                }
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            if (valid()) rowActionError = "Action failed. Refresh the list and try again."
        } finally {
            if (workspaceRevision == revision) rowActionSessionId = null
        }
    }
    suspend fun pin(row: AgentConversation, pinned: Boolean) = rowAction(row, archive = null, pinned = pinned)
    suspend fun archive(row: AgentConversation, archived: Boolean) = rowAction(row, archive = archived, pinned = null)

    // MARK: Make this a Bot, Turn into a Task, Archive Bot (iOS #1708; Archive Bot as on Desktop)
    /** Only the owner turns their own Task into a Bot or back, as on iOS. */
    fun canSetBot(row: AgentConversation) = currentActionRow(row)?.let {
        it.isOwner == true && it.readOnly != true && !it.isChannel && !it.isArchived
    } == true

    /** "Make this a Bot" gives back its 1:1 chat to open. "Turn into a Task" gives back null. */
    suspend fun setBot(row: AgentConversation, bot: Boolean): String? {
        val current = currentActionRow(row) ?: return null
        val team = selectedTeam?.id ?: return null
        if (!canSetBot(current) || current.isBot == bot || rowActionSessionId != null || archivingBotId != null) return null
        val workspace = workspaceRevision
        val consent = AiAccess.revision
        fun valid() = !disposed && hasAiAccess() && AiAccess.revision == consent && selectedTeam?.id == team && workspaceRevision == workspace
        rowActionSessionId = current.sessionId
        rowActionError = null
        try {
            BotActions.setBot(token, team, current.sessionId, bot)
            if (!valid()) return null
            reload()
            if (!valid()) return null
            loadChannels()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            if (valid()) rowActionError = if (bot) "Couldn't make this a Bot. Try again." else "Couldn't turn this into a Task. Try again."
            return null
        } finally {
            if (workspaceRevision == workspace) rowActionSessionId = null
        }
        if (!bot || !valid()) return null
        // The Bot exists now. Its chat is a step of its own, which Bots can try again.
        val chat = openBotChat(current.sessionId)
        if (chat == null && botChatError != null && valid()) {
            clearBotChatError()
            rowActionError = "This is a Bot now, but its chat couldn't be opened. Open it from Bots to try again."
        }
        return chat?.takeIf { valid() }
    }

    var archivingBotId by mutableStateOf<String?>(null)
        private set
    /** What the last Archive Bot left to say, shown only in the workspace it was in. */
    val botArchiveIssue: BotArchiveIssues.Issue?
        get() = BotArchiveIssues.of(token)?.takeIf { !disposed && it.teamId == selectedTeam?.id }
    fun dismissBotArchiveIssue() = BotArchiveIssues.clear(token)

    /** The owner's own Bot, listed and not archived. Its chats go with it. */
    fun canArchiveBot(botId: String) = conversations.firstOrNull { it.sessionId == botId }?.let { bot ->
        currentActionRow(bot) != null && bot.isBot && !bot.isArchived && bot.isOwner == true && bot.readOnly != true
    } == true && !disposed && hasAiAccess()

    fun archiveBot(botId: String) = runBotArchive(botId) { it.run(botId) }

    /** After a partial result: puts back the chats it reports as archived, after reading where they are now. */
    fun restoreBotChats() {
        val issue = botArchiveIssue ?: return
        val ids = issue.chats.filterValues { it != BotArchive.State.NotArchived }.keys
        if (ids.isEmpty()) return
        runBotArchive(issue.botId, issue.botTitle, requireListed = false) { it.restoreChats(issue.botId, ids) }
    }

    private fun runBotArchive(botId: String, title: String? = null, requireListed: Boolean = true,
        action: suspend (BotArchive) -> BotArchive.Result) {
        val team = selectedTeam?.id ?: return
        if (disposed || !hasAiAccess() || archivingBotId != null || rowActionSessionId != null) return
        if (requireListed && !canArchiveBot(botId)) return
        val botTitle = title ?: conversations.first { it.sessionId == botId }.displayTitle
        val workspace = workspaceRevision
        val consent = AiAccess.revision
        val signedIn = token
        // Checked before every request: access, the session and the workspace as they were when it began.
        fun allowed() = !disposed && hasAiAccess() && AiAccess.revision == consent && selectedTeam?.id == team && workspaceRevision == workspace
        val archive = BotArchive(
            listChats = { cursor -> NuphosApi.conversations(signedIn, team, cursor = cursor, limit = 100,
                scope = ConversationScope.Mine, includeArchived = true, channels = true) },
            setArchived = { id, archived -> ai.nuphos.android.data.ConversationActions.archive(signedIn, team, id, archived) },
            allowed = ::allowed,
        )
        archivingBotId = botId
        val signInEpoch = BotArchiveIssues.epoch
        BotArchiveIssues.clear(signedIn)
        BotArchiveIssues.scope.launch {
            val result = try { action(archive) } finally { if (archivingBotId == botId) archivingBotId = null }
            val quiet = result == BotArchive.Result.Archived || (result is BotArchive.Result.NotChanged && result.reason == null)
            if (!quiet) BotArchiveIssues.put(signedIn, BotArchiveIssues.Issue(team, botId, botTitle, result), signInEpoch)
            if (allowed()) storeScope.launch { reload(); loadChannels() }
        }
    }

    private var watchingSessionIds by mutableStateOf(emptySet<String>())
    /** Only the conversation being changed waits: every other one stays available. */
    fun isChangingWatch(sessionId: String) = sessionId in watchingSessionIds
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
        if (disposed || !hasAiAccess() || id in watchingSessionIds) return
        val revision = workspaceRevision
        fun current() = !disposed && hasAiAccess() && selectedTeam?.id == team && workspaceRevision == revision
        watchingSessionIds = watchingSessionIds + id
        watchError = null
        // Released once, when this write ends: by then a later write may hold the same conversation.
        var writing = true
        fun writeEnded() {
            if (writing && current()) watchingSessionIds = watchingSessionIds - id
            writing = false
        }
        try {
            ConversationActions.watch(token, team, id, watching)
            if (!current()) return
            // Reads that started before this write can no longer land, but what's shown stays:
            // the row changed here is known, and DELETE's cascade comes from the reads below.
            loadGeneration++
            isLoadingMore = false
            conversations = conversations.map { if (it.sessionId == id && (it.teamId ?: team) == team) it.copy(watching = watching) else it }
            val affected = sessions.values.filter { it.teamId == team }.toList()
            affected.forEach { if (it.sessionId == id) it.applyWatching(watching) else it.watchingChangedElsewhere() }
            // The item can be used again while the reads below run.
            writeEnded()
            reload()
            var refreshFailed = phaseError != null
            for (session in affected) {
                if (!current()) return
                try { session.refreshWatching() } catch (e: kotlinx.coroutines.CancellationException) { throw e
                } catch (_: Exception) { if (session.loaded) refreshFailed = true }
            }
            if (current() && refreshFailed) watchError = "Watch change saved, but status could not refresh. Refresh and try again."
        } catch (e: kotlinx.coroutines.CancellationException) { throw e
        } catch (e: Exception) {
            if (current()) watchError = "Could not update watch status. Refresh and try again."
        } finally {
            writeEnded()
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
                    "This agent is unavailable or you no longer have permission to unlink it."
                else -> "Could not unlink agent. Try again."
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

    private var newModelKey: Triple<Long, String, String>? = null
    var newModelSettings by mutableStateOf<ModelSettingsStore?>(null)
        private set

    init {
        // Work outlives the view. Clean it only when its account capability expires.
        storeScope.launch {
            snapshotFlow { hasAiAccess() }.first { !it }
            disposeForConsent()
        }
    }

    fun updateSearch(value: String) {
        if (value == search) return
        search = value
        resetHistory()
        searchJob?.cancel()
        searchJob = storeScope.launch {
            delay(250)
            launch { loadChannels() }
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
                rowActionSessionId = null
                rowActionError = null
                watchingSessionIds = emptySet()
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
                rowActionSessionId = null
                rowActionError = null
                watchingSessionIds = emptySet()
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
                    rowActionSessionId = null
                    rowActionError = null
                    watchingSessionIds = emptySet()
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
        rowActionSessionId = null
        rowActionError = null
        watchingSessionIds = emptySet()
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
        listRuntimes(force = false)
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
                // Like iOS: only the user's own, non-archived agents.
                scope = ConversationScope.Mine,
                search = search,
            )
            if (generation != loadGeneration || selectedTeam?.id != team.id || workspace != workspaceRevision || disposed || !hasAiAccess()) return
            observeHistory(page.rows, team.id, observedAt)
            conversations = mergeHistory(page.rows, team.id).distinctBy { it.sessionId }
            BotFaces.learn(conversations)
            nextCursor = page.nextCursor
            hasMore = page.hasMore
            phase = Phase.Loaded
            if (channelsLoaded) rememberHasChats()
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
                    if (!hasLoadedHistory) phaseError = "Agent list refresh was interrupted. Try again."
                }
            }
        }
        loadMissingPinnedHistory()
    }

    suspend fun loadMore() = loadMore(allowDuringRefresh = false)

    private suspend fun loadMore(allowDuringRefresh: Boolean) {
        val team = selectedTeam
        val cursor = nextCursor
        if (disposed || !hasAiAccess() || (!allowDuringRefresh && isRefreshing) || isReloading || phase != Phase.Loaded || !hasMore || isLoadingMore || team == null || cursor == null) return
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
                // Like iOS: only the user's own, non-archived agents.
                scope = ConversationScope.Mine,
                search = search,
            )
            if (generation != loadGeneration || selectedTeam?.id != team.id || workspace != workspaceRevision || disposed || !hasAiAccess()) return
            observeHistory(page.rows, team.id, observedAt)
            val merged = mergeHistory(page.rows, team.id).distinctBy { it.sessionId }
            val seen = conversations.map { it.sessionId }.toSet()
            conversations = conversations.map { current ->
                merged.firstOrNull { it.sessionId == current.sessionId && (it.teamId ?: team.id) == (current.teamId ?: team.id) } ?: current
            } + merged.filter { it.sessionId !in seen }
            BotFaces.learn(merged)
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

    fun bindNewModelSettings(selection: RuntimeSelections.Selection?): ModelSettingsStore? {
        val runtime = selection?.selected
        val team = selectedTeam
        val key = if (runtime != null && team != null && selection.valid) Triple(workspaceRevision, runtime.id, runtime.provider) else null
        if (key != newModelKey) {
            newModelSettings?.invalidate()
            newModelKey = key
            newModelSettings = if (key == null || runtime == null || team == null) null else ModelSettingsStore(
                isCurrent = { !disposed && hasAiAccess() && selectedTeam?.id == team.id && workspaceRevision == key.first &&
                    selection.valid && selection.selected?.id == runtime.id && selection.selected?.provider == runtime.provider },
                writable = { true }, streaming = { false },
                read = { pick -> ai.nuphos.android.data.ModelSettingsApi.newConfig(token, team.id, runtime.id, pick) },
            )
        }
        return newModelSettings
    }

    fun newSession(selection: RuntimeSelections.Selection? = null): ChatSession? {
        if (!credentialsReady) return null
        val team = selectedTeam ?: return null
        if (selection != null && (!selection.valid || selection.teamId != team.id || selection.reselectionRequired)) return null
        val model = bindNewModelSettings(selection)
        if (model != null && !model.canStart) return null
        val session = ChatSession.fresh(token, team.id, selection?.binding)
        session.presetPermissionMode(permissionMode)
        session.presetModelSettings(model?.initialPick.orEmpty())
        session.credentialAccess = credentialSelection
        sessions[SessionKey(team.id, session.sessionId)] = session
        return session
    }

    fun disposeForConsent() {
        disposed = true
        newModelSettings?.invalidate()
        newModelSettings = null
        newModelKey = null
        credentials = credentials.reset()
        membershipRequest++
        workspaceRevision++
        rowActionSessionId = null
        rowActionError = null
        watchingSessionIds = emptySet()
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
        private const val HAS_CHATS_KEY = "nuphos.home.hasChats"
        private const val PERMISSION_KEY = "nuphos.agentPermissionMode"
    }
}
