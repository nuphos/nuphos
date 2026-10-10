package ai.nuphos.android.ui.agent

import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
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

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun AgentPage(
    searching: Boolean,
    onSearchingChange: (Boolean) -> Unit,
    nav: NavHostController,
) {
    val store = LocalAgentStore.current
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val auth = ai.nuphos.android.ui.LocalAuthSession.current
    val account = auth.user?.id
    val team = store.selectedTeam
    val revision = store.workspaceRevision
    val consentRevision = ai.nuphos.android.session.AiAccess.revision
    val authGeneration = auth.generation
    val selection = remember(account, team?.id, authGeneration, consentRevision) {
        if (account != null && team != null && auth.aiAllowed) auth.runtimeSelections.bind(account, team.id) else null
    }
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
    if (setupVisible && setup != null && setup.isSourceCurrent()) RuntimeSetupSheet(setup, { setupVisible = false })

    var statusClock by remember(store) { mutableStateOf(RuntimeObservation.now()) }
    LaunchedEffect(store, store.historyRevision, store.conversations, statusClock) {
        val now = RuntimeObservation.now()
        val expiry = store.conversations.mapNotNull { store.historyObservation(it)?.runtime?.observedAt?.plus(12.0) }.filter { it > now }.minOrNull()
        if (expiry != null) { delay(((expiry - now) * 1000).toLong() + 1); statusClock = RuntimeObservation.now() }
    }
    val pins = store.pinnedShortcuts
    LaunchedEffect(store, store.selectedTeam?.id) { store.loadFavorites() }
    LaunchedEffect(listState, store.hasMore, store.conversations) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.map { it.key } }
            .collect { keys ->
                if (store.hasMore && PinnedHistory.shouldLoadMore(keys, store.conversations.map { it.sessionId })) {
                    store.loadMore()
                }
            }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(horizontal = 16.dp)) {
            AgentSelectionButton(selection, enabled = setup != null && auth.aiAllowed, onClick = { setupVisible = true })
        }
        if (selection?.reselectionRequired == true) Text("Select an available Agent before starting a new chat.", Modifier.padding(horizontal = 16.dp))
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = !store.archivedOnly, onClick = { store.updateArchivedOnly(false) }, label = { Text("Active") })
            FilterChip(selected = store.archivedOnly, onClick = { store.updateArchivedOnly(true) }, label = { Text("Archived") })
        }
        if (searching) {
            SearchField(
                value = store.search,
                onValueChange = store::updateSearch,
                placeholder = "Search chats",
                onCancel = {
                    store.updateSearch("")
                    onSearchingChange(false)
                },
            )
        }
        if (store.search.isEmpty() && !store.archivedOnly) {
            if (store.favoritesLoading) Text("Loading pinned chats…", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall)
            store.favoritesError?.let {
                Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Could not refresh pinned chats.", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                    Button(onClick = { scope.launch { store.loadFavorites() } }) { Text("Retry pins") }
                }
            }
        }
        if (store.phase == AgentStore.Phase.Loaded && store.phaseError != null) {
            Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Could not refresh chats. Showing last loaded history.", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                Button(onClick = { scope.launch { store.reload() } }) { Text("Retry history") }
            }
        }
        Box(Modifier.weight(1f)) {
            when {
                store.phase == AgentStore.Phase.Loading || store.phase == AgentStore.Phase.Idle -> {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            LoadingIndicator()
                            Text("Loading chats…", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 12.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                store.phase == AgentStore.Phase.Failed -> {
                    EmptyState(
                        icon = Icons.Outlined.WifiOff,
                        title = "Couldn't load chats",
                        body = store.phaseError.orEmpty(),
                        action = "Try again",
                        onAction = { scope.launch { store.loadTeams() } },
                    )
                }
                store.conversations.isEmpty() && pins.isEmpty() -> {
                    EmptyState(
                        icon = Icons.Outlined.ChatBubbleOutline,
                        title = if (store.search.isEmpty()) "No chats yet" else "No matches",
                        body = if (store.search.isEmpty()) "Start a conversation from the bar below." else "No conversations match your search.",
                    )
                }
                else -> {
                    LazyColumn(
                        state = listState,
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (pins.isNotEmpty()) {
                            item(key = "pins:header") { Text("Pinned", style = MaterialTheme.typography.titleSmall) }
                            items(pins, key = { it.listKey }) { pin ->
                                Card(Modifier.fillMaxWidth().clickable {
                                    nav.navigate("conversation/${android.net.Uri.encode(pin.sessionId)}")
                                }) {
                                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                                        Icon(Icons.Outlined.PushPin, contentDescription = "Pinned chat")
                                        Text(pin.title, Modifier.padding(start = 12.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                }
                            }
                            item(key = "history:header") { Text("History", style = MaterialTheme.typography.titleSmall) }
                        }
                        items(store.conversations, key = { "history:${it.sessionId}" }) { conversation ->
                            ConversationRow(conversation, store.favorites?.contains(conversation.sessionId) == true, store.historyObservation(conversation)?.label(maxOf(statusClock, RuntimeObservation.now()))) {
                                nav.navigate("conversation/${conversation.sessionId}")
                            }
                        }
                        if (store.hasMore) {
                            item {
                                Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                                    LoadingIndicator()
                                }
                            }
                        }
                    }
                }
            }
        }
        val draftAuth = ai.nuphos.android.ui.LocalAuthSession.current
        val draftAccount = draftAuth.user?.id
        val draftTeam = store.selectedTeam?.id
        val draft = remember(draftAccount, draftTeam, draftAuth.generation, ai.nuphos.android.session.AiAccess.revision) {
            draftAccount?.let { draftAuth.composerDrafts.bind(it, draftTeam, ai.nuphos.android.session.ComposerDrafts.Destination.NewChat, ai.nuphos.android.session.AiAccess.bind(draftAuth.token.orEmpty())) }
        }
        ChatComposer(
            draft = draft,
            draftingEnabled = draft != null && draftAuth.aiAllowed && store.selectedTeam != null,
            isStreaming = false,
            onSend = { submission ->
                val session = store.newSession(selection) ?: return@ChatComposer false
                store.pendingPrompt = submission
                nav.navigate("conversation/${session.sessionId}?fresh=true")
                true
            },
            showControls = true,
        )
    }
}

@Composable
private fun ConversationRow(conversation: AgentConversation, pinned: Boolean, status: String?, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
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
            if (pinned) {
                Icon(Icons.Outlined.PushPin, contentDescription = "Pinned chat", tint = MaterialTheme.colorScheme.outline, modifier = Modifier.size(18.dp))
            }
            if (conversation.isArchived) {
                Icon(Icons.Outlined.Archive, contentDescription = "Archived", tint = MaterialTheme.colorScheme.outline, modifier = Modifier.size(18.dp))
            }
        }
    }
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
