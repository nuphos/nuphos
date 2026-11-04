package ai.nuphos.android.ui.chats

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.model.ChannelItem
import ai.nuphos.android.model.ChannelPost
import ai.nuphos.android.model.ChatTime
import ai.nuphos.android.model.TransferUpload
import ai.nuphos.android.data.TransferDownloads
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.ChannelSession
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.components.AgentAvatar
import ai.nuphos.android.ui.components.MarkdownText
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** A chat opened from the list, a link or a notification. It never runs an agent turn. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChannelScreen(sessionId: String, onBack: () -> Unit, onLink: (String) -> Unit = {}) {
    val store = LocalAgentStore.current
    val auth = LocalAuthSession.current
    val teamId = store.selectedTeam?.id
    val session = remember(store, teamId, store.workspaceRevision, AiAccess.revision, sessionId) { store.channelSession(sessionId) }
    if (session == null) { LaunchedEffect(Unit) { onBack() }; return }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    // Only while on screen and in the foreground: polled every 4 s like Desktop and iOS, and read
    // up to its newest activity. Coming back reads it at once and marks what arrived meanwhile.
    LaunchedEffect(session, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            launch { session.poll() }
            snapshotFlow { session.activitySeq to session.reads }.collect {
                session.readUpToNewest { seq -> store.markChannelRead(session.teamId, session.channelId, seq) }
            }
        }
    }
    val viewerId = auth.user?.id
    // Which of this chat's agents are in a turn, checked every 3 s, only while on screen.
    LaunchedEffect(store, session, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                store.loadAgentTurns(session.agents.map { it.sessionId })
                delay(3_000)
            }
        }
    }
    // The dots follow a read of the chat that started after the change and succeeded. An agent posts
    // before its turn ends, so its reply and the end of its dots arrive together, never the dots' end first.
    var typing by remember(session) { mutableStateOf(emptyList<ChannelAgent>()) }
    val inTurn = session.agents.filter { store.inTurn(it.sessionId) }
    LaunchedEffect(session, lifecycle, inTurn.map { it.sessionId }) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (inTurn.map { it.sessionId } != typing.map { it.sessionId }) {
                if (session.refresh(force = true)) typing = inTurn else delay(ChannelSession.POLL_MS)
            }
        }
    }
    val items = ChannelPost.items(session.posts, session.events, typing)
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            CenterAlignedTopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ChannelMark(28.dp)
                        Text(session.title, maxLines = 1, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    }
                },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
    ) { padding ->
        // The keyboard inset replaces, rather than adds to, the bar inset the scaffold already applied.
        Column(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding).imePadding()) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                !session.loaded -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                session.loadError != null && items.isEmpty() -> Column(Modifier.align(Alignment.Center).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(session.loadError.orEmpty())
                    val scope = rememberCoroutineScope()
                    TextButton(onClick = { scope.launch { session.refresh(force = true) } }) { Text("Try again") }
                }
                else -> {
                    val consent = AiAccess.revision
                    ChannelTranscript(session, items, viewerId, onLink, allowed = {
                        AiAccess.revision == consent && store.selectedTeam?.id == session.teamId && auth.aiAllowed
                    })
                }
            }
        }
        // Keyed by session: a new workspace, account or consent gets a new composer scope, and the
        // old one's in-flight upload is cancelled with it.
        if (session.loaded && session.loadError == null && !session.readOnly) key(session) { ChannelComposer(session) }
        }
    }
}

/** Newest at the bottom; the list opens there and keeps the reader's place while reading older posts. */
@Composable
internal fun ChannelTranscript(session: ChannelSession, items: List<ChannelItem>, viewerId: String?, onLink: (String) -> Unit, allowed: () -> Boolean = { true },
                                downloads: TransferDownloads = remember { TransferDownloads() }) {
    val state = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val reversed = items.asReversed()
    val atLatest by remember { derivedStateOf { state.firstVisibleItemIndex == 0 && state.firstVisibleItemScrollOffset < 48 } }
    var wasAtLatest by remember { mutableStateOf(true) }
    val newest = reversed.firstOrNull()?.key
    // Follow a new post only when the reader was already at the end.
    LaunchedEffect(newest) { if (wasAtLatest && reversed.isNotEmpty()) state.scrollToItem(0) }
    LaunchedEffect(atLatest) { wasAtLatest = atLatest }
    // Your own send returns the transcript to the end.
    LaunchedEffect(session.lastSubmittedKey) { if (session.lastSubmittedKey != null && reversed.isNotEmpty()) state.scrollToItem(0) }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize().testTag("channel-transcript"), state = state, reverseLayout = true,
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp)) {
            items(reversed, key = { it.key }) { item ->
                when (item) {
                    is ChannelItem.Post -> PostRow(session, item.post, item.first, item.post.isMine(viewerId), onLink, allowed, downloads)
                    is ChannelItem.Time -> TimeDivider(item.at)
                    is ChannelItem.Paused -> PausedLine(item.text)
                    is ChannelItem.Typing -> TypingRow(item)
                }
            }
        }
        if (!atLatest) SmallFloatingActionButton(
            onClick = { scope.launch { state.animateScrollToItem(0) } },
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp).semantics { contentDescription = "Scroll to latest" },
        ) { Icon(Icons.Outlined.ArrowDownward, null) }
    }
}

/** Yours on the right; everyone else's on the left under their avatar and name, once per run. */
@Composable
private fun PostRow(session: ChannelSession, post: ChannelPost, first: Boolean, mine: Boolean, onLink: (String) -> Unit, allowed: () -> Boolean,
                    downloads: TransferDownloads) {
    Row(Modifier.fillMaxWidth().padding(top = if (first) 12.dp else 4.dp)) {
        if (mine) Spacer(Modifier.weight(1f).widthIn(min = 48.dp))
        Column(Modifier.widthIn(max = 300.dp), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
            if (first && !mine) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(start = 4.dp, end = 4.dp, bottom = 4.dp)) {
                Box(Modifier.testTag("channel-avatar")) { SenderAvatar(post) }
                Text(post.name, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                if (post.isAgent) Text("Agent", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh)
                        .padding(horizontal = 6.dp, vertical = 2.dp))
            }
            // A person's files show above their words, as on iOS.
            if (post.uploads.isNotEmpty()) Box(Modifier.padding(bottom = 6.dp)) {
                ChannelFiles(post.uploads, mine, session::transferGroup, allowed, downloads)
            }
            // A post on its way shows the files it is uploading.
            if (post.sending) session.sendingAttachments[post.id]?.forEach { attachment ->
                Text(attachment.name, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 4.dp).clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.surfaceContainerHigh).padding(horizontal = 8.dp, vertical = 4.dp))
            }
            // A bubble is as wide as its words, up to the column's width.
            if (post.text.isNotEmpty()) Surface(modifier = Modifier.width(IntrinsicSize.Max), shape = RoundedCornerShape(18.dp),
                color = if (mine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh) {
                Box(Modifier.padding(horizontal = 14.dp, vertical = 9.dp)) { MarkdownText(post.text, onLink = onLink, compact = true) }
            }
            // An agent's files show below its words, every group in one grid.
            if (post.downloads.isNotEmpty()) Box(Modifier.padding(top = 6.dp)) {
                ChannelFiles(post.downloads.map { TransferUpload(it, emptyList()) }, mine, session::transferGroup, allowed, downloads)
            }
        }
        if (!mine) Spacer(Modifier.weight(1f).widthIn(min = 48.dp))
    }
}

/** A centered time above a post that follows a pause of more than five minutes. */
@Composable
private fun TimeDivider(at: java.time.Instant) {
    Text(ChatTime.label(at), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.outline,
        textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 4.dp).testTag("channel-time"))
}

private val AVATAR = 20.dp

@Composable
private fun SenderAvatar(post: ChannelPost) {
    if (post.isAgent) { AgentAvatar(post.senderId, runtime = null, size = AVATAR); return }
    Box(Modifier.size(AVATAR).clip(CircleShape).background(MaterialTheme.colorScheme.primary),
        contentAlignment = Alignment.Center) {
        Text(post.name.split(' ').filter { it.isNotBlank() }.take(2).joinToString("") { it.take(1).uppercase() },
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.sp, lineHeight = 8.sp), color = MaterialTheme.colorScheme.onPrimary)
        post.avatarURL?.let { coil3.compose.AsyncImage(it, null, Modifier.size(AVATAR), contentScale = ContentScale.Crop) }
    }
}

@Composable
private fun PausedLine(text: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp).border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(20.dp))
        .padding(horizontal = 14.dp, vertical = 8.dp).testTag("channel-paused"), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(Icons.Outlined.Pause, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.tertiary)
        Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun TypingRow(item: ChannelItem.Typing) {
    Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        item.agents.forEach { agent ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.semantics { contentDescription = "${agent.title.ifBlank { "Agent" }} is typing" }) {
                AgentAvatar(agent.sessionId, runtime = null, size = 36.dp)
                Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                    Text("•••", Modifier.padding(horizontal = 16.dp, vertical = 8.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

/** The conversation composer, posting to the chat: photos, files, paste and dictation work as there. */
@Composable
private fun ChannelComposer(session: ChannelSession) {
    val store = LocalAgentStore.current
    val auth = LocalAuthSession.current
    val scope = rememberCoroutineScope()
    val account = auth.user?.id
    // Drafts persist per chat, like a conversation's.
    val draft = remember(account, session.teamId, session.channelId, auth.generation, AiAccess.revision) {
        account?.let { auth.composerDrafts.bind(it, session.teamId, ai.nuphos.android.session.ComposerDrafts.Destination.Chat(session.channelId),
            AiAccess.bind(auth.token.orEmpty())) }
    }
    session.sendError?.let { message ->
        AlertDialog(onDismissRequest = { session.sendError = null }, title = { Text("Couldn't send the message") },
            text = { Text(message) }, confirmButton = { TextButton(onClick = { session.sendError = null }) { Text("OK") } })
    }
    ai.nuphos.android.ui.chat.ChatComposer(
        isStreaming = false,
        onSend = { submission ->
            val user = auth.user
            // Captured now: a post whose upload outlives this account, workspace or consent is never sent.
            val generation = auth.generation
            val account = user?.id
            val workspace = store.workspaceRevision
            val consent = AiAccess.revision
            val allowed = {
                auth.generation == generation && auth.user?.id == account && store.workspaceRevision == workspace &&
                    AiAccess.revision == consent && store.selectedTeam?.id == session.teamId && auth.aiAllowed && !session.readOnly
            }
            session.send(submission, user?.id, user?.name, user?.avatar, scope, allowed)
        },
        canSubmit = auth.aiAllowed && store.selectedTeam?.id == session.teamId,
        draft = draft,
        draftingEnabled = draft != null && auth.aiAllowed,
        // A post that failed goes back into the composer.
        rejectedSubmission = session.unsent,
        onRejectedRestored = { session.unsent = null },
        placeholder = "Message #${session.title}",
    )
}
