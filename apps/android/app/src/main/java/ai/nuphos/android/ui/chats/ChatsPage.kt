package ai.nuphos.android.ui.chats

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource

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
                // The agent list too, as iOS polls it: its runtime states are what a Bot's row reads for its dots.
                store.reload()
                delay(3_000)
            }
        }
    }
    val rows = store.botsList
    var showNewBot by rememberSaveable { mutableStateOf(false) }
    var botArchiveTarget by remember(team, store.workspaceRevision) { mutableStateOf<String?>(null) }
    botArchiveTarget?.let { ai.nuphos.android.ui.agent.ArchiveBotDialog(store, it) { botArchiveTarget = null } }
    ai.nuphos.android.ui.agent.BotArchiveIssueDialog(store)
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
            dismissButton = { TextButton(onClick = { store.clearBotChatError() }) { Text(stringResource(R.string.chats_ok)) } },
            confirmButton = { TextButton(onClick = {
                val botId = store.botChatFailedId
                store.clearBotChatError()
                botId?.let(::openBot)
            }) { Text(stringResource(R.string.try_again)) } },
        )
    }
    Column(Modifier.fillMaxSize()) {
    if (searching) ai.nuphos.android.ui.components.SearchField(
        value = store.search,
        onValueChange = store::updateSearch,
        placeholder = stringResource(R.string.chats_search_bots),
        onCancel = { store.updateSearch(""); onSearchingChange(false) },
    )
    if (store.hasRuntimes == false) ai.nuphos.android.ui.agent.FirstRuntimePrompt()
    // Like iOS, no "+" either: a Bot would have nothing to run on.
    else if (!store.channelsLoaded && rows.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    // Bots always lists, so its "+" can make the first one.
    } else LazyColumn(Modifier.fillMaxSize().testTag("chats-list")) {
        item(key = "bots-header") {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.chats_bots), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                IconButton(onClick = { showNewBot = true }, enabled = !store.creatingBot) {
                    Icon(Icons.Outlined.Add, stringResource(R.string.chats_new_bot))
                }
            }
        }
        items(rows, key = { it.sessionId }) { row ->
            val botId = if (row.isChannel) row.botId else row.sessionId
            ChatRow(row, typing = row.botTyping(store::typingIn), selected = row.sessionId == selectedSessionId, opening = store.openingBotId == row.sessionId,
                onArchiveBot = botId?.takeIf { store.canArchiveBot(it) }?.let { { botArchiveTarget = it } }) {
                if (row.isChannel) nav.navigate("channel/${android.net.Uri.encode(row.sessionId)}") { launchSingleTop = true }
                else openBot(row.sessionId)
            }
        }
    }
    }
    if (showNewBot) {
        val auth = ai.nuphos.android.ui.LocalAuthSession.current
        val account = auth.user?.id
        NewBotSheet(store.creatingBot, store.newBotError, store.newBotWaitingForChat != null,
            onCreate = { title, avatar ->
                // On the runtime a new chat would use, so the Bot's composer shows it.
                val runtime = if (account != null && team != null) auth.runtimeSelections.bind(account, team).binding else null
                scope.launch(kotlinx.coroutines.Dispatchers.Main.immediate) {
                    val chat = store.createBot(title, avatar, runtime) ?: return@launch
                    showNewBot = false
                    nav.navigate("channel/${android.net.Uri.encode(chat)}") { launchSingleTop = true }
                }
            },
            onDismiss = { store.forgetNewBot(); showNewBot = false },
        )
    }
}

@Composable
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
private fun ChatRow(chat: AgentConversation, typing: Boolean, selected: Boolean, opening: Boolean, onArchiveBot: (() -> Unit)? = null, onOpen: () -> Unit) {
    val unread = chat.isChannel && chat.hasUnreadPosts()
    val title = if (chat.isChannel) chat.displayTitleForChat else chat.displayTitle
    val preview = chat.previewLine
    var menu by remember { mutableStateOf(false) }
    val typingLabel = stringResource(R.string.chats_is_typing, title)
    val unreadLabel = stringResource(R.string.chats_unread_posts)
    val openingLabel = stringResource(R.string.chats_opening)
    // A long press offers Archive Bot, as Desktop's sidebar does for a Bot and its chat.
    Box { DropdownMenu(expanded = menu && onArchiveBot != null, onDismissRequest = { menu = false }) {
        DropdownMenuItem(text = { Text(stringResource(R.string.chats_archive_bot)) }, leadingIcon = { Icon(Icons.Outlined.Archive, null) },
            onClick = { menu = false; onArchiveBot?.invoke() })
    }
    ListItem(
        modifier = Modifier.combinedClickable(enabled = !opening, onClick = onOpen,
            onLongClick = onArchiveBot?.let { { menu = true } }, onLongClickLabel = onArchiveBot?.let { stringResource(R.string.chats_more_actions) })
            .testTag("chat-row:${chat.sessionId}").semantics {
            contentDescription = listOfNotNull(title, if (typing) typingLabel else preview, unreadLabel.takeIf { unread }, openingLabel.takeIf { opening }).joinToString(", ")
        },
        colors = ListItemDefaults.colors(containerColor = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.background),
        leadingContent = {
            if (chat.isChannel) ChatIcon(chat.faces.orEmpty(), title, 40.dp)
            else AgentAvatar(chat.sessionId, chat.agentRuntime, 40.dp)
        },
        headlineContent = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        // As iMessage does: the dots stand in for the newest post until the reply lands.
        supportingContent = if (typing) ({ TypingDots(Modifier.padding(vertical = 7.dp)) })
            else preview?.let { { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) } },
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
}

/** An unnamed chat is called by its one other member, which is how a Bot's 1:1 chat gets its name. */
internal val AgentConversation.displayTitleForChat: String
    @Composable get() = title.ifBlank { faces?.singleOrNull()?.name?.takeIf { it.isNotBlank() } ?: stringResource(R.string.chats_untitled_chat) }

/** Where a group's faces sit in a 36dp box, whoever spoke last largest: left, top and size. */
internal val ChatCluster = listOf(Triple(0f, 0f, 24f), Triple(18f, 12f, 18f), Triple(5f, 22f, 14f))

/**
 * A chat's icon: the one other member's face, or up to three members clustered as in the design
 * system. A chat with nobody else shows its title's initials.
 */
@Composable
internal fun ChatIcon(faces: List<ChatFace>, title: String, size: Dp) {
    when {
        faces.isEmpty() -> NuphosAvatar(NuphosUser(id = "", name = title), size)
        faces.size == 1 -> Face(faces[0], size)
        // Each face's ring cuts the faces beneath it out, so it is whatever lies behind the icon.
        else -> Box(Modifier.size(size).graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }) {
            val scale = size / 36.dp
            faces.take(ChatCluster.size).forEachIndexed { index, face ->
                val (x, y, disc) = ChatCluster[index]
                Box(
                    Modifier.offset((x - 2).dp * scale, (y - 2).dp * scale).size((disc + 4).dp * scale)
                        .drawBehind { drawCircle(Color.Black, blendMode = BlendMode.Clear) },
                )
                Box(
                    Modifier.offset(x.dp * scale, y.dp * scale).size(disc.dp * scale).clip(CircleShape)
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                ) { Face(face, disc.dp * scale, showBadge = false) }
            }
        }
    }
}

@Composable
private fun Face(face: ChatFace, size: Dp, showBadge: Boolean = true) {
    if (face.agent != null) AgentAvatar(face.id, face.agent.provider, size, showBadge)
    else NuphosAvatar(NuphosUser(id = face.id, name = face.name, avatarURL = face.avatarURL.orEmpty()), size)
}
