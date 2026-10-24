package ai.nuphos.android.ui.agent

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.ui.draw.drawBehind
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.runtime.saveable.rememberSaveable
import ai.nuphos.android.session.ConversationNesting
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.NotificationsOff
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.NavHostController
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.HistoryTime
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.session.HistoryStatus
import ai.nuphos.android.session.RuntimeObservation
import ai.nuphos.android.session.PinnedHistory
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.chat.ChatComposer
import ai.nuphos.android.ui.components.NuphosAvatar
import ai.nuphos.android.ui.components.SearchField
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

@OptIn(ExperimentalMaterial3ExpressiveApi::class, ExperimentalMaterial3Api::class)
@Composable
fun AgentPage(
    searching: Boolean,
    onSearchingChange: (Boolean) -> Unit,
    nav: NavHostController,
    showComposer: Boolean = true,
    selectedSessionId: String? = null,
    newChatComposer: @Composable () -> Unit = { NewChatComposer(nav) },
) {
    val store = LocalAgentStore.current
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(store, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            // Initial membership loading selects and loads the team itself.
            store.refreshOnResume()
        }
    }
    val auth = ai.nuphos.android.ui.LocalAuthSession.current
    val account = auth.user?.id
    val team = store.selectedTeam
    val revision = store.workspaceRevision
    val consentRevision = ai.nuphos.android.session.AiAccess.revision
    LaunchedEffect(store, team, revision) { store.loadCredentialOptions() }
    val authGeneration = auth.generation
    val rowInteractions = remember(store, revision, consentRevision, authGeneration, team?.id) { ConversationRowInteractions() }
    val rowOrder = store.conversations.map { it.sessionId to it.parentSessionId }
    LaunchedEffect(rowOrder, store.sort, store.search, store.archivedOnly) { rowInteractions.dismiss() }
    LaunchedEffect(listState.isScrollInProgress) { if (listState.isScrollInProgress) rowInteractions.dismiss() }
    var archiveTarget by remember(store, revision, consentRevision, authGeneration) { mutableStateOf<AgentConversation?>(null) }
    if (store.rowActionError != null && archiveTarget == null) AlertDialog(
        onDismissRequest = { store.clearRowActionError() }, title = { Text("Action failed") },
        text = { Text(store.rowActionError.orEmpty()) },
        confirmButton = { TextButton(onClick = { store.clearRowActionError(); scope.launch { store.reload(); store.loadFavorites() } }) { Text("Refresh") } },
    )
    archiveTarget?.takeIf { store.canArchive(it) }?.let { target ->
        val busy = store.rowActionSessionId != null
        AlertDialog(onDismissRequest = { if (!busy) { archiveTarget = null; store.clearRowActionError() } },
            title = { Text(if (target.isArchived) "Restore agent?" else "Archive agent?") },
            text = { Column {
                Text(if (target.isArchived) "Move this agent to Active." else "You can restore this agent from Archived.")
                store.rowActionError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            } },
            confirmButton = { TextButton(enabled = !busy, onClick = { scope.launch {
                store.archive(target, !target.isArchived)
                if (store.rowActionError == null) archiveTarget = null
            } }) { Text(if (busy) "Saving…" else if (target.isArchived) "Restore" else "Archive") } },
            dismissButton = { TextButton(enabled = !busy, onClick = { archiveTarget = null; store.clearRowActionError() }) { Text("Cancel") } },
        )
    }

    var unlinkTarget by remember(store, revision, consentRevision, authGeneration) { mutableStateOf<AgentConversation?>(null) }
    if (store.watchError != null) AlertDialog(onDismissRequest = { store.clearWatchError() },
        title = { Text("Watch update failed") }, text = { Text(store.watchError.orEmpty()) },
        confirmButton = { TextButton(onClick = { store.clearWatchError(); scope.launch { store.refreshWatchState() } }) { Text("Refresh") } })
    val target = unlinkTarget
    if (target != null && store.canUnlink(target)) {
        UnlinkConfirmation(target, store.unlinkingSessionId == target.sessionId, store.unlinkError,
            onDismiss = { if (store.unlinkingSessionId == null) { unlinkTarget = null; store.clearUnlinkError() } },
            onConfirm = { scope.launch {
                store.unlinkParent(target)
                if (store.unlinkError == null && store.unlinkingSessionId == null) unlinkTarget = null
            } })
    }

    var statusClock by remember(store) { mutableStateOf(RuntimeObservation.now()) }
    LaunchedEffect(store, store.historyRevision, store.conversations, statusClock) {
        val now = RuntimeObservation.now()
        val expiry = store.conversations.mapNotNull { store.historyObservation(it)?.runtime?.observedAt?.plus(12.0) }.filter { it > now }.minOrNull()
        if (expiry != null) { delay(((expiry - now) * 1000).toLong() + 1); statusClock = RuntimeObservation.now() }
    }
    val pins = store.pinnedShortcuts
    var foldedIds by rememberSaveable(account, team?.id) { mutableStateOf(emptyList<String>()) }
    val tree = remember(store.conversations, pins, foldedIds, account) {
        ConversationNesting.nest(store.conversations, pins.mapTo(mutableSetOf()) { it.sessionId }, foldedIds.toSet(), account)
    }
    val treeSections = remember(tree) { tree.rows.groupBy { it.section } }
    LaunchedEffect(tree.rows.map { Triple(it.conversation.sessionId, it.depth, it.section) }) { rowInteractions.dismiss() }
    val shortcuts = pins.filter { it.sessionId !in tree.loadedPinnedIds }
    LaunchedEffect(store, store.selectedTeam?.id) { store.loadFavorites() }
    LaunchedEffect(listState, store.hasMore, store.conversations) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.map { it.key } }
            .collect { keys ->
                // Source tail IDs may be folded or move in tree order; the explicit footer remains available.
                if (store.hasMore && PinnedHistory.shouldLoadMore(keys, store.conversations.map { it.sessionId })) {
                    store.loadMore()
                }
            }
    }

    Column(Modifier.fillMaxSize().dismissRowActionsOnOutsidePress(rowInteractions)) {
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = !store.archivedOnly, onClick = { store.updateArchivedOnly(false) }, label = { Text("Active") })
            FilterChip(selected = store.archivedOnly, onClick = { store.updateArchivedOnly(true) }, label = { Text("Archived") })
        }
        if (searching) {
            SearchField(
                value = store.search,
                onValueChange = store::updateSearch,
                placeholder = "Search agents",
                onCancel = {
                    store.updateSearch("")
                    onSearchingChange(false)
                },
            )
        }
        if (store.search.isEmpty() && !store.archivedOnly) {
            if (store.favoritesLoading) Text("Loading pinned agents…", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall)
            store.favoritesError?.let {
                Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Could not refresh pinned agents.", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                    Button(onClick = { scope.launch { store.loadFavorites() } }) { Text("Retry pins") }
                }
            }
        }
        if (store.phase == AgentStore.Phase.Loaded && store.phaseError != null) {
            Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Could not refresh agents. Showing last loaded history.", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                Button(onClick = { scope.launch { store.reload() } }) { Text("Retry history") }
            }
        }
        PullToRefreshBox(
            isRefreshing = store.isRefreshing,
            onRefresh = store::refresh,
            modifier = Modifier.weight(1f).fillMaxWidth().testTag("chat-history-refresh"),
        ) {
            when {
                store.phase == AgentStore.Phase.Loading || store.phase == AgentStore.Phase.Idle -> {
                    RefreshableHistoryState {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            LoadingIndicator()
                            Text("Loading agents…", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 12.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                store.phase == AgentStore.Phase.Failed -> {
                    RefreshableHistoryState { EmptyState(
                        icon = Icons.Outlined.WifiOff,
                        title = "Couldn't load agents",
                        body = store.phaseError.orEmpty(),
                        action = "Try again",
                        onAction = store::refresh,
                    ) }
                }
                store.conversations.isEmpty() && pins.isEmpty() -> {
                    RefreshableHistoryState { EmptyState(
                        icon = Icons.Outlined.ChatBubbleOutline,
                        title = if (store.search.isEmpty()) "No agents yet" else "No matches",
                        body = if (store.search.isNotEmpty()) "No agents match your search."
                            else if (showComposer) "Start an agent from the bar below."
                            else "Start an agent in the pane beside this list.",
                    ) }
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        state = listState,
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        for (section in ConversationNesting.Section.entries) {
                            val rows = treeSections[section].orEmpty()
                            if (rows.isNotEmpty() || (section == ConversationNesting.Section.Pinned && shortcuts.isNotEmpty())) {
                                item(key = "section:$section") { Text(section.title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                            if (section == ConversationNesting.Section.Pinned) {
                                items(shortcuts, key = { it.listKey }) { pin ->
                                    Card(Modifier.fillMaxWidth().clickable {
                                        nav.navigate("conversation/${android.net.Uri.encode(pin.sessionId)}") { popUpTo("home"); launchSingleTop = true }
                                    }) {
                                        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                                            Icon(Icons.Outlined.PushPin, contentDescription = "Pinned agent")
                                            Text(pin.title, Modifier.padding(start = 12.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        }
                                    }
                                }
                            }
                            items(rows, key = { "history:${it.conversation.sessionId}" }) { row ->
                                ConversationTreeRow(row, store.favorites?.contains(row.conversation.sessionId) == true,
                                    ConversationNesting.status(row) { store.historyObservation(it)?.label(maxOf(statusClock, RuntimeObservation.now())) },
                                    onWatch = if (store.canWatch(row.conversation)) ({ scope.launch { store.setWatching(row.conversation) } }) else null,
                                    watchBusy = store.watchingSessionId != null,
                                    onUnlink = if (store.canUnlink(row.conversation)) ({ store.clearUnlinkError(); unlinkTarget = row.conversation }) else null,
                                    unlinking = store.unlinkingSessionId == row.conversation.sessionId,
                                    interactions = rowInteractions,
                                    onPin = { scope.launch { store.pin(row.conversation, store.favorites?.contains(row.conversation.sessionId) != true) } },
                                    pinEnabled = store.canPin(row.conversation),
                                    onArchive = if (store.canArchive(row.conversation)) ({ store.clearRowActionError(); archiveTarget = row.conversation }) else null,
                                    actionBusy = store.rowActionSessionId != null,
                                    onToggle = {
                                        foldedIds = if (row.conversation.sessionId in foldedIds) foldedIds - row.conversation.sessionId else foldedIds + row.conversation.sessionId
                                    },
                                    onClick = { nav.navigate("conversation/${android.net.Uri.encode(row.conversation.sessionId)}") { popUpTo("home"); launchSingleTop = true } },
                                    selected = row.conversation.sessionId == selectedSessionId)
                            }
                        }
                        if (store.hasMore) {
                            item(key = "history:more") {
                                TextButton(onClick = { scope.launch { store.loadMore() } }, modifier = Modifier.fillMaxWidth()) {
                                    Text("Load more agents")
                                }
                            }
                        }
                    }
                }
            }
        }
        if (showComposer) newChatComposer()
    }
}

/** An empty/error page still dispatches nested scroll without losing viewport centering. */
@Composable
private fun RefreshableHistoryState(content: @Composable () -> Unit) {
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) { content() }
        }
    }
}

/** Cap visual indentation so malformed/deep trees cannot squeeze the title off-screen. */
@Composable
internal fun ConversationTreeRow(row: ConversationNesting.Row, pinned: Boolean, status: String?, onToggle: () -> Unit, onClick: () -> Unit, onUnlink: (() -> Unit)? = null, unlinking: Boolean = false, onWatch: (() -> Unit)? = null, watchBusy: Boolean = false, selected: Boolean = false, interactions: ConversationRowInteractions = remember { ConversationRowInteractions() }, onPin: (() -> Unit)? = null, pinEnabled: Boolean = true, onArchive: (() -> Unit)? = null, actionBusy: Boolean = false) {
    val depth = row.depth.coerceAtMost(4)
    val line = MaterialTheme.colorScheme.outlineVariant
    Box(Modifier.fillMaxWidth().drawBehind {
        if (depth > 0) {
            val indent = (depth * 16).dp.toPx()
            val rtl = layoutDirection == androidx.compose.ui.unit.LayoutDirection.Rtl
            val x = if (rtl) size.width - indent + 8.dp.toPx() else indent - 8.dp.toPx()
            val end = if (rtl) size.width - indent else indent
            drawLine(line, Offset(x, 0f), Offset(x, size.height / 2), 1.dp.toPx())
            drawLine(line, Offset(x, size.height / 2), Offset(end, size.height / 2), 1.dp.toPx())
        }
    }.padding(start = (depth * 16).dp).semantics {
        stateDescription = "Sub-agent level ${row.depth}"; this.selected = selected
    }) {
        ConversationRow(row.conversation, pinned, status, row.threads, row.folded, onToggle, onClick, onUnlink, unlinking, onWatch, watchBusy, selected, interactions, onPin, pinEnabled, onArchive, actionBusy)
    }
}

@Composable
private fun ConversationRow(conversation: AgentConversation, pinned: Boolean, status: String?, threads: Int = 0, folded: Boolean = false, onToggle: () -> Unit = {}, onClick: () -> Unit, onUnlink: (() -> Unit)? = null, unlinking: Boolean = false, onWatch: (() -> Unit)? = null, watchBusy: Boolean = false, selected: Boolean = false, interactions: ConversationRowInteractions = remember { ConversationRowInteractions() }, onPin: (() -> Unit)? = null, pinEnabled: Boolean = true, onArchive: (() -> Unit)? = null, actionBusy: Boolean = false) {
    val actions = buildList {
        if (onWatch != null) add(ConversationRowAction("watch", if (conversation.watching == true) "Unwatch" else "Watch",
            if (conversation.watching == true) Icons.Outlined.NotificationsOff else Icons.Outlined.Notifications, !watchBusy && !actionBusy, onWatch))
        if (onUnlink != null) add(ConversationRowAction("unlink", if (unlinking) "Unlinking…" else "Unlink", Icons.Outlined.LinkOff, !unlinking && !actionBusy, onUnlink))
        if (onPin != null) add(ConversationRowAction("pin", if (pinned) "Unpin" else "Pin", Icons.Outlined.PushPin, pinEnabled && !actionBusy, onPin))
        if (onArchive != null) add(ConversationRowAction("archive", if (conversation.isArchived) "Restore" else "Archive",
            if (conversation.isArchived) Icons.Outlined.Unarchive else Icons.Outlined.Archive, !actionBusy, onArchive))
    }
    ConversationRowActions(conversation.sessionId, actions, interactions, onClick) { surface, more ->
        Card(
            modifier = Modifier.fillMaxWidth().then(surface),
            colors = CardDefaults.cardColors(containerColor = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerLow),
            shape = MaterialTheme.shapes.large,
            elevation = CardDefaults.cardElevation(0.dp),
        ) {
            Row(
                Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                NuphosAvatar(
                    NuphosUser(
                        id = conversation.owner?.id.orEmpty(),
                        email = conversation.owner?.email.orEmpty(),
                        name = conversation.owner?.name.orEmpty(),
                        avatarURL = conversation.owner?.avatarURL.orEmpty(),
                    ),
                    size = 40.dp,
                )
                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                    Text(conversation.displayTitle, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (status != null) Text(status, style = MaterialTheme.typography.labelSmall)
                    else if (HistoryStatus.unread(conversation)) Text("Unread", style = MaterialTheme.typography.labelSmall)
                    Text(meta(conversation), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (threads > 0) {
                    TextButton(onClick = onToggle, modifier = Modifier.semantics {
                        stateDescription = if (folded) "Collapsed" else "Expanded"
                    }) {
                        Text("$threads")
                        Icon(if (folded) Icons.Outlined.ExpandMore else Icons.Outlined.ExpandLess,
                            contentDescription = "${if (folded) "Show" else "Hide"} $threads sub-agents")
                    }
                }
                more()
                if (pinned) {
                    Icon(Icons.Outlined.PushPin, contentDescription = "Pinned agent", tint = MaterialTheme.colorScheme.outline, modifier = Modifier.size(18.dp))
                }
                if (conversation.isArchived) {
                    Icon(Icons.Outlined.Archive, contentDescription = "Archived", tint = MaterialTheme.colorScheme.outline, modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}

/** Android adds an explicit confirmation; iOS performs the context-menu action directly. */
@Composable
internal fun UnlinkConfirmation(target: AgentConversation, busy: Boolean, error: String?, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Unlink agent?") },
        text = { Column {
            Text("“${target.displayTitle}” will appear on its own in the agent list. Its messages and sharing permissions will stay the same.")
            if (error != null) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp))
        } },
        confirmButton = { TextButton(onClick = onConfirm, enabled = !busy) { Text(if (busy) "Unlinking…" else "Unlink") } },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") } },
    )
}

private fun meta(conversation: AgentConversation): String {
    val parts = mutableListOf(HistoryTime.format(conversation.lastActiveAt))
    if (conversation.messageCount > 0) {
        parts += "${conversation.messageCount} message${if (conversation.messageCount == 1) "" else "s"}"
    }
    conversation.tokenUsage?.costUsd?.takeIf { it > 0 }?.let { cost ->
        parts += if (cost < 0.01) "<$0.01" else String.format(Locale.US, "$%.2f", cost)
    }
    conversation.activitySource?.origin?.takeIf { it != "nuphos" && it != "unknown" }?.let {
        parts += it.replaceFirstChar { c -> c.uppercase() }
    }
    return parts.joinToString(" · ")
}

@Composable
fun EmptyState(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    body: String,
    action: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(40.dp), tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(16.dp))
        Text(title, style = MaterialTheme.typography.headlineSmall)
        Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
        if (action != null && onAction != null) {
            Button(onClick = onAction, modifier = Modifier.padding(top = 16.dp)) { Text(action) }
        }
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class, ExperimentalMaterial3Api::class)
@Composable
fun NewChatComposer(nav: NavHostController) {
    val store = LocalAgentStore.current
    val scope = rememberCoroutineScope()
    val auth = ai.nuphos.android.ui.LocalAuthSession.current
    val account = auth.user?.id
    val team = store.selectedTeam
    val revision = store.workspaceRevision
    val consentRevision = ai.nuphos.android.session.AiAccess.revision
    val authGeneration = auth.generation
    val selection = remember(account, team?.id, authGeneration, consentRevision) {
        if (account != null && team != null && auth.aiAllowed) auth.runtimeSelections.bind(account, team.id) else null
    }
    val quotas = rememberRuntimeQuotas(auth.token, team?.id)
    var setupVisible by remember { mutableStateOf(false) }
    val setup = remember(account, team, revision, consentRevision, authGeneration, selection) {
        if (team != null && selection != null && auth.token != null) ai.nuphos.android.session.RuntimeSetupStore(
            ai.nuphos.android.data.AgentRuntimeApi(auth.token!!, team.id), scope,
            { auth.generation == authGeneration && auth.user?.id == account && auth.aiAllowed &&
                ai.nuphos.android.session.AiAccess.revision == consentRevision && store.workspaceRevision == revision && store.selectedTeam == team },
            { store.selectedTeam == team && store.selectedTeam?.isAdministrator == true }, selection,
            { if (auth.generation == authGeneration && auth.user?.id == account) auth.signOut(ai.nuphos.android.data.NuphosApi.Failure.Unauthorized.message) }) else null
    }
    LaunchedEffect(setup) { setupVisible = false }
    if (setupVisible && setup != null && setup.isSourceCurrent()) RuntimeSetupSheet(setup, { setupVisible = false }, quotas = quotas)

    // The notice opens the picker itself, since the chip it refers to
    // sits in the composer at the bottom of the page.
    if (selection?.reselectionRequired == true) TextButton(onClick = { setupVisible = true }, enabled = setup != null && auth.aiAllowed, modifier = Modifier.padding(horizontal = 4.dp)) {
        Text("Select an available runtime before starting a new agent.")
    }
    val draftAuth = ai.nuphos.android.ui.LocalAuthSession.current
    val draftAccount = draftAuth.user?.id
    val draftTeam = store.selectedTeam?.id
    val draft = remember(draftAccount, draftTeam, draftAuth.generation, ai.nuphos.android.session.AiAccess.revision) {
        draftAccount?.let { draftAuth.composerDrafts.bind(it, draftTeam, ai.nuphos.android.session.ComposerDrafts.Destination.NewChat, ai.nuphos.android.session.AiAccess.bind(draftAuth.token.orEmpty())) }
    }
    val modelSettings = remember(store, selection, selection?.selected, store.workspaceRevision) { store.bindNewModelSettings(selection) }
    LaunchedEffect(modelSettings) { modelSettings?.refresh() }
    ChatComposer(
        modelSettings = modelSettings,
        mentions = draftTeam?.let { team ->
            remember(store, team) {
                ai.nuphos.android.ui.chat.SessionMentionSource(team) { query ->
                    store.mentionableSessions(team, query)
                }
            }
        },
        devices = draftTeam?.let { team ->
            remember(store, team, store.workspaceRevision) {
                ai.nuphos.android.ui.chat.DeviceMentionSource(team,
                    load = { store.mentionableComputers(team) },
                    pick = { device ->
                        if (store.selectedTeam?.id != team || !draftAuth.aiAllowed) false
                        else ai.nuphos.android.ui.chat.DeviceMention.select(store.credentialSelection, device)?.let {
                            store.updateCredentialSelection(it)
                            true
                        } ?: false
                    },
                )
            }
        },
        draft = draft,
        draftingEnabled = draft != null && draftAuth.aiAllowed && store.selectedTeam != null,
        canSubmit = store.credentialsReady && modelSettings?.canStart != false,
        isStreaming = false,
        onSend = { submission ->
            val session = store.newSession(selection) ?: return@ChatComposer false
            store.pendingPrompt = submission
            nav.navigate("conversation/${session.sessionId}?fresh=true")
            true
        },
        showControls = true,
        agentQuota = selection?.selectedId?.let { quotas[it] },
        agent = selection,
        agentEnabled = setup != null && auth.aiAllowed,
        onChooseAgent = { setupVisible = true },
    )
}
