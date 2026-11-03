package ai.nuphos.android.ui.chats

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.HistoryTime
import ai.nuphos.android.ui.LocalAgentStore
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay

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

/** Chats where people and agents talk, as on iOS and Desktop. */
@Composable
internal fun ChatsPage(nav: NavHostController, selectedSessionId: String? = null, searching: Boolean = false,
    onSearchingChange: (Boolean) -> Unit = {}, active: Boolean = true) {
    val store = LocalAgentStore.current
    val team = store.selectedTeam?.id
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
    val chats = store.channels
    Column(Modifier.fillMaxSize()) {
    if (searching) ai.nuphos.android.ui.components.SearchField(
        value = store.search,
        onValueChange = store::updateSearch,
        placeholder = "Search chats",
        onCancel = { store.updateSearch(""); onSearchingChange(false) },
    )
    when {
        !store.channelsLoaded && chats.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        chats.isEmpty() -> Column(Modifier.fillMaxSize().padding(32.dp).testTag("chats-empty"),
            verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Outlined.Forum, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(if (store.search.isEmpty()) "No chats yet" else "No matches", style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp))
            Text(if (store.search.isEmpty()) "Chats where people and agents talk together show up here." else "No chats match your search.",
                style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center, modifier = Modifier.padding(top = 8.dp))
        }
        else -> LazyColumn(Modifier.fillMaxSize().testTag("chats-list")) {
            items(chats, key = { it.sessionId }) { chat ->
                ChatRow(chat, selected = chat.sessionId == selectedSessionId) {
                    nav.navigate("channel/${android.net.Uri.encode(chat.sessionId)}") { launchSingleTop = true }
                }
            }
        }
    }
    }
}

@Composable
private fun ChatRow(chat: AgentConversation, selected: Boolean, onOpen: () -> Unit) {
    val unread = chat.hasUnreadPosts()
    ListItem(
        modifier = Modifier.clickable(onClick = onOpen).semantics {
            contentDescription = chat.displayTitle + if (unread) ", unread posts" else ""
        },
        colors = ListItemDefaults.colors(containerColor = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.background),
        leadingContent = { ChannelMark(40.dp) },
        headlineContent = { Text(chat.displayTitleForChat, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = { Text(HistoryTime.format(chat.lastActiveAt), color = MaterialTheme.colorScheme.onSurfaceVariant) },
        trailingContent = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (unread) Box(Modifier.size(10.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary).testTag("chat-unread"))
                Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.outline)
            }
        },
    )
}

internal val AgentConversation.displayTitleForChat: String get() = title.ifBlank { "Untitled chat" }

/** The "#" mark that stands for a chat. */
@Composable
internal fun ChannelMark(size: androidx.compose.ui.unit.Dp) {
    Box(Modifier.size(size).clip(RoundedCornerShape(size / 4)).background(MaterialTheme.colorScheme.surfaceContainerHigh),
        contentAlignment = Alignment.Center) {
        Text("#", style = if (size >= 32.dp) MaterialTheme.typography.titleLarge else MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

