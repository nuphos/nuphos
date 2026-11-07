package ai.nuphos.android.ui.chats

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.ChatFace
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.ui.components.AgentAvatar
import ai.nuphos.android.ui.components.NuphosAvatar
import ai.nuphos.android.model.HistoryTime
import ai.nuphos.android.ui.LocalAgentStore
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Whether a chat row has posts the viewer has not read, from the same read state as agents. */
internal object Unread {
    fun AgentConversation.unread(): Boolean {
        this.unread?.boolValue?.let { return it }
        val activity = activitySeq?.numberValue ?: return false
        val read = readSeq?.numberValue ?: return activity > 0
        return activity > read
    }
}

internal fun AgentConversation.hasUnreadPosts(): Boolean = with(Unread) { unread() }

/** Chats where people and agents talk, and each Bot without a chat yet, as on iOS and Desktop. */
@Composable
internal fun ChatsPage(nav: NavHostController, selectedSessionId: String? = null, searching: Boolean = false,
    onSearchingChange: (Boolean) -> Unit = {}, active: Boolean = true) {
    val store = LocalAgentStore.current
    val team = store.selectedTeam?.id
    val scope = rememberCoroutineScope()
    // Refreshed with the list while it is on screen, like the iOS list poll. Only while the
    // screen is resumed: a backgrounded app or a page left behind must not keep reading.
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(store, team, store.workspaceRevision, lifecycle, active) {
        if (!active) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.RESUMED) {
            while (true) {
                store.loadChannels()
                delay(3_000)
            }
        }
    }
    val rows = store.botsList
    // A Bot's chat is made on the first tap. The list stays up meanwhile, so a failure has a place to show.
    fun openBot(botId: String) {
        scope.launch(kotlinx.coroutines.Dispatchers.Main.immediate) {
            val chat = store.openBotChat(botId) ?: return@launch
            nav.navigate("channel/${android.net.Uri.encode(chat)}") { launchSingleTop = true }
        }
    }
    store.botChatError?.let { message ->
        AlertDialog(
            onDismissRequest = { store.clearBotChatError() },
            text = { Text(message) },
            dismissButton = { TextButton(onClick = { store.clearBotChatError() }) { Text("OK") } },
            confirmButton = { TextButton(onClick = {
                val botId = store.botChatFailedId
                store.clearBotChatError()
                botId?.let(::openBot)
            }) { Text("Try again") } },
        )
    }
    Column(Modifier.fillMaxSize()) {
    if (searching) ai.nuphos.android.ui.components.SearchField(
        value = store.search,
        onValueChange = store::updateSearch,
        placeholder = "Search bots",
        onCancel = { store.updateSearch(""); onSearchingChange(false) },
    )
    when {
        !store.channelsLoaded && rows.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        rows.isEmpty() -> Column(Modifier.fillMaxSize().padding(32.dp).testTag("chats-empty"),
            verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Outlined.Forum, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(if (store.search.isEmpty()) "No bots yet" else "No matches", style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp))
            Text(if (store.search.isEmpty()) "Bots and chats with people show up here." else "No bots or chats match your search.",
                style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center, modifier = Modifier.padding(top = 8.dp))
        }
        else -> LazyColumn(Modifier.fillMaxSize().testTag("chats-list")) {
            items(rows, key = { it.sessionId }) { row ->
                ChatRow(row, selected = row.sessionId == selectedSessionId, opening = store.openingBotId == row.sessionId) {
                    if (row.isChannel) nav.navigate("channel/${android.net.Uri.encode(row.sessionId)}") { launchSingleTop = true }
                    else openBot(row.sessionId)
                }
            }
        }
    }
    }
}

@Composable
private fun ChatRow(chat: AgentConversation, selected: Boolean, opening: Boolean, onOpen: () -> Unit) {
    val unread = chat.isChannel && chat.hasUnreadPosts()
    val title = if (chat.isChannel) chat.displayTitleForChat else chat.displayTitle
    val preview = chat.previewLine
    ListItem(
        modifier = Modifier.clickable(enabled = !opening, onClick = onOpen).testTag("chat-row:${chat.sessionId}").semantics {
            contentDescription = listOfNotNull(title, preview, "unread posts".takeIf { unread }, "opening".takeIf { opening }).joinToString(", ")
        },
        colors = ListItemDefaults.colors(containerColor = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface),
        leadingContent = {
            if (chat.isChannel) ChatIcon(chat.faces.orEmpty(), title, 40.dp)
            else AgentAvatar(chat.sessionId, chat.agentRuntime, 40.dp)
        },
        headlineContent = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = preview?.let { { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) } },
        trailingContent = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(HistoryTime.format(chat.lastActiveAt), style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                if (unread) Box(Modifier.size(10.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary).testTag("chat-unread"))
                if (opening) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                else Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.outline)
            }
        },
    )
}

/** An unnamed chat is called by its one other member, which is how a Bot's 1:1 chat gets its name. */
internal val AgentConversation.displayTitleForChat: String
    get() = title.ifBlank { faces?.singleOrNull()?.name?.takeIf { it.isNotBlank() } ?: "Untitled chat" }

/**
 * A chat's icon, as iMessage draws one: the one other member's face, or two overlapping, whoever spoke
 * last in front. A chat with nobody else shows its title's initials.
 */
@Composable
internal fun ChatIcon(faces: List<ChatFace>, title: String, size: Dp) {
    val front = faces.getOrNull(0)
    val back = faces.getOrNull(1)
    when {
        front == null -> NuphosAvatar(NuphosUser(id = "", name = title), size)
        back == null -> Face(front, size)
        else -> Box(Modifier.size(size)) {
            val small = size * 0.72f
            Box(Modifier.align(Alignment.TopStart)) { Face(back, small) }
            Box(Modifier.align(Alignment.BottomEnd).clip(CircleShape).background(MaterialTheme.colorScheme.background)
                .padding(1.5.dp)) { Face(front, small - 3.dp) }
        }
    }
}

@Composable
private fun Face(face: ChatFace, size: Dp) {
    if (face.agent != null) AgentAvatar(face.id, face.agent.provider, size)
    else NuphosAvatar(NuphosUser(id = face.id, name = face.name, avatarURL = face.avatarURL.orEmpty()), size)
}

