package ai.nuphos.android.ui.chat

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Error
import androidx.compose.material.icons.outlined.Handyman
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.withFrameNanos
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import ai.nuphos.android.session.ConversationReads
import ai.nuphos.android.session.AiAccess
import androidx.compose.runtime.key
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import ai.nuphos.android.model.ChatPart
import ai.nuphos.android.model.ChatRow
import ai.nuphos.android.model.ChatTime
import ai.nuphos.android.model.PlanLink
import ai.nuphos.android.session.ChatSession
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.components.MarkdownText
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ConversationScreen(
    sessionId: String,
    fresh: Boolean,
    onBack: () -> Unit,
    nav: NavHostController,
    browsingOnly: Boolean = false,
    browsingTeamId: String? = null,
) {
    val store = LocalAgentStore.current
    val token = if (browsingOnly) LocalAuthSession.current.token else null
    val selectedTeamId = store.selectedTeam?.id
    val validBrowse = !browsingOnly || (browsingTeamId != null && selectedTeamId == browsingTeamId && token != null)
    LaunchedEffect(validBrowse) { if (!validBrowse) onBack() }
    if (!validBrowse) return
    val conversation = store.conversations.firstOrNull { it.sessionId == sessionId && (it.teamId == null || it.teamId == selectedTeamId) }
    val session = remember(store, sessionId, selectedTeamId, browsingTeamId, browsingOnly, token) {
        if (browsingOnly) ChatSession(token!!, browsingTeamId!!, sessionId, browsingOnly = true)
        else if (fresh) store.session(sessionId, "New chat")
        else conversation?.let { store.session(it) } ?: store.session(sessionId, store.pinnedShortcuts.firstOrNull { it.sessionId == sessionId }?.title ?: "Chat")
    }
    DisposableEffect(session) {
        onDispose { session.disposeBrowsing() }
    }
    val auth = LocalAuthSession.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var resumed by remember(lifecycle) { mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
    val reads = remember(session) { ConversationReads() }
    val readTarget = ConversationReads.Target("${auth.generation}:${AiAccess.revision}", session.teamId, session.sessionId)
    val visible = resumed && !browsingOnly && auth.aiAllowed && store.selectedTeam?.id == session.teamId
    DisposableEffect(lifecycle, reads) {
        val observer = LifecycleEventObserver { _, _ ->
            resumed = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
            if (!resumed) reads.hidden()
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); reads.hidden() }
    }
    DisposableEffect(reads, visible, readTarget) {
        if (visible) reads.visible(readTarget) else reads.hidden()
        onDispose { reads.hidden() }
    }
    val transcript = session.readTranscript
    LaunchedEffect(session, transcript, session.messages, visible, readTarget) {
        if (!visible || transcript == null || !session.readAllowed || transcript.messages != session.messages) return@LaunchedEffect
        withFrameNanos { }
        repeat(2) { attempt ->
            if (!visible || !session.readAllowed || session.readTranscript != transcript || transcript.messages != session.messages) return@LaunchedEffect
            val ticket = reads.begin(readTarget, transcript.generation, transcript.seq) ?: return@LaunchedEffect
            try {
                val state = store.markRead(session.teamId, session.sessionId, ticket.seq)
                if (reads.accepts(ticket, readTarget, session.readTranscript?.generation ?: -1, session.readAllowed && transcript.messages == session.messages)) {
                    store.applyRead(session.teamId, session.sessionId, ticket.seq, state)
                    reads.completed(ticket)
                }
                return@LaunchedEffect
            } catch (e: kotlinx.coroutines.CancellationException) {
                reads.failed(ticket)
                throw e
            } catch (_: Exception) {
                reads.failed(ticket)
                if (attempt == 0) delay(1_000)
            }
        }
    }
    var alwaysTarget by remember { mutableStateOf<ChatPart.Tool?>(null) }
    var alwaysRule by remember { mutableStateOf("") }
    var toolDetail by remember { mutableStateOf<ChatPart.Tool?>(null) }

    LaunchedEffect(session) {
        if (browsingOnly) {
            if (store.selectedTeam?.id != browsingTeamId) return@LaunchedEffect
            session.load()
            return@LaunchedEffect
        }
        val prompt = store.pendingPrompt
        store.pendingPrompt = null
        if (fresh && prompt != null) {
            session.send(prompt)
        } else if (!session.loaded) {
            session.load()
        }
        session.pollWhileIdle()
    }

    var refreshBrowse by remember(session) { mutableStateOf(0) }
    LaunchedEffect(session, refreshBrowse) {
        if (browsingOnly && refreshBrowse > 0 && store.selectedTeam?.id == browsingTeamId) session.reloadFromServer()
    }
    val rows = ChatRow.rows(session)
    val listState = rememberLazyListState()
    val uriHandler = LocalUriHandler.current
    LaunchedEffect(rows.size, session.isStreaming) {
        if (session.followsBottom && rows.isNotEmpty()) {
            delay(30)
            listState.animateScrollToItem(rows.lastIndex)
        }
    }

    var showTitle by remember(session.title) { mutableStateOf(false) }
    if (showTitle) androidx.compose.material3.AlertDialog(
        onDismissRequest = { showTitle = false },
        title = { Text("Chat title") },
        text = { androidx.compose.foundation.text.selection.SelectionContainer { Text(session.title) } },
        confirmButton = { TextButton(onClick = { showTitle = false }) { Text("Done") } },
    )
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets.safeDrawing,
        topBar = {
            TopAppBar(
                title = {
                    Text(session.title, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.clickable { showTitle = true }.semantics { contentDescription = "Show full chat title" })
                },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") }
                },
                actions = {
                    if (browsingOnly) TextButton(onClick = { refreshBrowse += 1 }) { Text("Refresh") }
                    else ConversationMenu(session, store, onBack)
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .consumeWindowInsets(padding),
        ) {
            if (session.loaded && session.loadError == null) {
                session.runtimeDeviceLabel?.let {
                    Text("Agent: $it", modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.bodyMedium, maxLines = 2,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                }
            }
            if (session.loaded && session.loadError == null && session.isArchived) {
                Text("Archived chat", Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            when {
                !session.loaded -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { LoadingIndicator() }
                session.loadError != null -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text(session.loadError ?: "", color = MaterialTheme.colorScheme.error)
                }
                else -> LazyColumn(
                    state = listState,
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(rows, key = { it.id }) { row ->
                        ChatRowView(
                            row = row,
                            session = session,
                            onLink = { url ->
                                val target = PlanLink.target(url)
                                if (!browsingOnly) {
                                    if (target != null) nav.navigate("plan/${target.planId}")
                                    else uriHandler.openUri(url)
                                } else if (target == null) {
                                    val uri = runCatching { java.net.URI(url) }.getOrNull()
                                    if (uri?.scheme?.equals("https", ignoreCase = true) == true &&
                                        !uri.host.isNullOrBlank() && uri.rawUserInfo == null) uriHandler.openUri(url)
                                }
                            },
                            onAlwaysAllow = {
                                alwaysRule = it.authorization?.get("suggestedRule")?.stringValue.orEmpty()
                                alwaysTarget = it
                            },
                            onOpenTool = { toolDetail = it },
                        )
                    }
                }
            }
            if (!browsingOnly) {
                if (session.runtimeRecoveryRequired) {
                    Text("Message delivery needs to be checked before you send again.", modifier = Modifier.padding(horizontal = 16.dp))
                    TextButton(enabled = session.loaded && !session.readOnly, onClick = session::recoverRuntime) { Text("Check delivery") }
                }
                if (session.steeringRetryRequired) {
                    Text("Steering was rejected. Your unsent text is retained.", modifier = Modifier.padding(horizontal = 16.dp))
                    TextButton(enabled = session.loaded && !session.readOnly, onClick = session::retryQueued) { Text("Retry steering") }
                }
                session.uploadDraft?.let { draft ->
                    Column(Modifier.padding(horizontal = 16.dp)) {
                        Text(draft.text.ifBlank { "Attachment message" }, maxLines = 2)
                        Text(draft.attachments.joinToString(", ") { it.name }, maxLines = 2)
                        session.uploadProgress?.let { progress ->
                            Text(when (progress.stage) {
                                ai.nuphos.android.data.AttachmentTransfers.Stage.Intent -> "Preparing upload…"
                                ai.nuphos.android.data.AttachmentTransfers.Stage.Uploading -> "Uploading ${progress.bytesWritten} / ${progress.totalBytes} bytes"
                                ai.nuphos.android.data.AttachmentTransfers.Stage.Finalizing -> "Checking uploaded files…"
                                ai.nuphos.android.data.AttachmentTransfers.Stage.Ready -> "Files ready"
                            })
                        }
                        session.uploadError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                        Row {
                            if (session.uploadBusy) TextButton(onClick = session::cancelUpload) { Text("Cancel upload") }
                            else TextButton(enabled = session.canSubmit, onClick = session::retryUpload) { Text("Retry attachment message") }
                            TextButton(onClick = session::discardUpload) { Text("Remove attachment message") }
                        }
                    }
                }
                session.runtimeLabel?.let { Text(it, modifier = Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall) }
                if (session.cancelRequested) Text("Cancellation requested", modifier = Modifier.padding(horizontal = 16.dp))
                if (session.isNative && session.canCancel) TextButton(onClick = session::stop) { Text("Cancel run") }
                if (session.readOnly) Text("Read-only chat", modifier = Modifier.padding(horizontal = 16.dp))
                if (session.queued.isNotEmpty()) {
                    Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        session.queued.forEachIndexed { i, item ->
                            Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                                Row(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(item, maxLines = 1, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f, false).widthIn(max = 180.dp))
                                    TextButton(onClick = { session.removeQueued(i) }) { Text("×") }
                                }
                            }
                        }
                    }
                }
                val draftAuth = ai.nuphos.android.ui.LocalAuthSession.current
                val draftAccount = draftAuth.user?.id
                val draftTeam = session.teamId
                val draft = remember(draftAccount, draftTeam, draftAuth.generation, ai.nuphos.android.session.AiAccess.revision) {
                    draftAccount?.let { draftAuth.composerDrafts.bind(it, draftTeam, ai.nuphos.android.session.ComposerDrafts.Destination.Chat(sessionId), ai.nuphos.android.session.AiAccess.bind(draftAuth.token.orEmpty())) }
                }
                ChatComposer(
                    draft = draft,
                    draftingEnabled = draft != null && draftAuth.aiAllowed && store.selectedTeam != null,
                    isStreaming = session.isStreaming && !session.isNative,
                    onSend = session::send,
                    canSubmit = session.canSubmit && session.uploadDraft == null,
                    rejectedSubmission = session.rejectedSubmission,
                    onRejectedRestored = session::clearRejectedSubmission,
                    onStop = if (session.canCancel) session::stop else null,
                    showControls = session.canManage,
                    selection = session.credentialAccess ?: ai.nuphos.android.model.CredentialSelection(),
                    onSelectionChange = { if (session.canManage) session.credentialAccess = it },
                    mode = session.permissionMode,
                    onModeChange = session::updatePermissionMode,
                )
            } else {
                Text("Read-only run", modifier = Modifier.padding(horizontal = 16.dp))
            }
        }
    }

    toolDetail?.let { part ->
        ToolDetailDialog(part, onDismiss = { toolDetail = null })
    }

    if (alwaysTarget != null) {
        AlertDialog(
            onDismissRequest = { alwaysTarget = null },
            title = { Text("Always allow") },
            text = {
                Column {
                    Text("Commands matching this description will run without asking.")
                    TextField(alwaysRule, onValueChange = { alwaysRule = it }, modifier = Modifier.padding(top = 8.dp))
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        alwaysTarget?.let { session.decide(it.toolCallId, ChatSession.ApprovalDecision.Always, alwaysRule) }
                        alwaysTarget = null
                    },
                    enabled = alwaysRule.isNotBlank(),
                ) { Text("Allow") }
            },
            dismissButton = { TextButton(onClick = { alwaysTarget = null }) { Text("Cancel") } },
        )
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun ChatRowView(
    row: ChatRow,
    session: ChatSession,
    onLink: (String) -> Unit,
    onAlwaysAllow: (ChatPart.Tool) -> Unit,
    onOpenTool: (ChatPart.Tool) -> Unit,
) {
    when (row) {
        is ChatRow.Timestamp -> Text(
            ChatTime.label(row.date),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.outline,
            modifier = Modifier.fillMaxWidth(),
        )
        is ChatRow.User -> Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
            row.images.take(4).forEach { url -> DataImage(url) }
            if (row.text.isNotEmpty()) {
                Surface(
                    shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp, bottomStart = 20.dp, bottomEnd = 6.dp),
                    color = MaterialTheme.colorScheme.primaryContainer,
                ) {
                    Text(row.text, modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp), color = MaterialTheme.colorScheme.onPrimaryContainer)
                }
            }
        }
        is ChatRow.AssistantText -> MarkdownText(row.text, streaming = row.streaming, onLink = onLink)
        is ChatRow.Reasoning -> ReasoningTile(row.part)
        is ChatRow.Tool -> ToolCallRow(row.part, row.canDecide, session, onOpenTool, onAlwaysAllow)
        is ChatRow.Work -> WorkGroup(row, session, onLink, onAlwaysAllow, onOpenTool)
        is ChatRow.Memory -> Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainer) {
            Row(Modifier.padding(horizontal = 10.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Memory, contentDescription = null, modifier = Modifier.size(14.dp))
                Text("Memory updated", modifier = Modifier.padding(start = 6.dp), style = MaterialTheme.typography.labelMedium)
            }
        }
        is ChatRow.MemoryRecall -> MemoryRecallRow(
            row,
            MemoryRecallAccess(
                loaded = session.canShowRecall(row),
                allowed = LocalAuthSession.current.aiAllowed,
                originTeamId = session.teamId,
                selectedTeamId = LocalAgentStore.current.selectedTeam?.id,
            ),
        )
        is ChatRow.Activity -> Row(verticalAlignment = Alignment.CenterVertically) {
            if (!row.text.isNullOrEmpty()) Text(row.text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.size(8.dp))
            LoadingIndicator(Modifier.size(20.dp))
        }
        is ChatRow.Hint -> Text(row.text, color = if (row.isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.bodySmall)
        ChatRow.Bottom -> Spacer(Modifier.height(1.dp))
    }
}

@Composable
private fun ReasoningTile(part: ChatPart.Reasoning) {
    var expanded by remember { mutableStateOf(false) }
    val thinking = part.state == ChatPart.StreamState.Streaming
    Column {
        Surface(
            onClick = { expanded = !expanded },
            shape = MaterialTheme.shapes.large,
            color = MaterialTheme.colorScheme.surfaceContainer,
        ) {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Psychology, contentDescription = null, modifier = Modifier.size(16.dp))
                Text(if (thinking) "Thinking…" else "Thought", modifier = Modifier.padding(start = 8.dp), style = MaterialTheme.typography.titleSmall)
            }
        }
        AnimatedVisibility(expanded) {
            Text(part.text, modifier = Modifier.padding(start = 16.dp, top = 8.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ToolCallRow(
    part: ChatPart.Tool,
    canDecide: Boolean,
    session: ChatSession,
    onOpen: (ChatPart.Tool) -> Unit,
    onAlwaysAllow: (ChatPart.Tool) -> Unit,
) {
    val tint = when (part.state) {
        ChatPart.Tool.State.InputStreaming, ChatPart.Tool.State.InputAvailable, ChatPart.Tool.State.ApprovalResponded -> MaterialTheme.colorScheme.primary
        ChatPart.Tool.State.ApprovalRequested -> MaterialTheme.colorScheme.tertiary
        ChatPart.Tool.State.OutputAvailable -> androidx.compose.ui.graphics.Color(0xFF2E7D32)
        ChatPart.Tool.State.OutputError -> MaterialTheme.colorScheme.error
        ChatPart.Tool.State.OutputDenied -> MaterialTheme.colorScheme.outline
    }
    Column {
        Surface(
            onClick = { onOpen(part) },
            shape = MaterialTheme.shapes.medium,
            color = tint.copy(alpha = 0.10f),
        ) {
            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    when (part.state) {
                        ChatPart.Tool.State.ApprovalRequested -> Icons.Outlined.PanTool
                        ChatPart.Tool.State.OutputAvailable -> Icons.Outlined.CheckCircle
                        ChatPart.Tool.State.OutputError -> Icons.Outlined.Error
                        else -> Icons.Outlined.Handyman
                    },
                    contentDescription = null,
                    tint = tint,
                    modifier = Modifier.size(18.dp),
                )
                Text(part.displayLabel, modifier = Modifier.padding(start = 8.dp).weight(1f), style = MaterialTheme.typography.titleSmall, maxLines = 1)
            }
        }
        if (part.state == ChatPart.Tool.State.ApprovalRequested) {
            val reason = part.authorization?.get("reason")?.stringValue
            Text(reason?.let { "Authorization required — $it" } ?: "Authorization required", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp))
            if (canDecide && !session.browsingOnly) {
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(modifier = Modifier.testTag("approve-once:${part.toolCallId}"), enabled = !session.readOnly && (if (session.isNative) session.canReply else session.canSubmit), onClick = { session.decide(part.toolCallId, ChatSession.ApprovalDecision.Once) }) { Text("Approve once") }
                    if (part.approval?.source != "openab") {
                        FilledTonalButton(enabled = session.canManage, onClick = { session.decide(part.toolCallId, ChatSession.ApprovalDecision.Session) }) { Text("For session") }
                    }
                }
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (part.approval?.source != "openab") {
                        OutlinedButton(enabled = session.canManage, onClick = { onAlwaysAllow(part) }) { Text("Always allow…") }
                    }
                    OutlinedButton(enabled = !session.readOnly && (if (session.isNative) session.canReply else session.canSubmit), onClick = { session.decide(part.toolCallId, ChatSession.ApprovalDecision.Deny) }) { Text("Deny") }
                }
            }
        }
    }
}

@Composable
private fun WorkGroup(
    row: ChatRow.Work,
    session: ChatSession,
    onLink: (String) -> Unit,
    onAlwaysAllow: (ChatPart.Tool) -> Unit,
    onOpenTool: (ChatPart.Tool) -> Unit,
) {
    var expanded by remember(row.id) { mutableStateOf(false) }
    val title = row.duration?.takeIf { it >= 1 }?.let { "Worked for ${it.toInt()}s · ${row.rows.size} steps" }
        ?: "Worked through ${row.rows.size} steps"
    Column {
        Surface(onClick = { expanded = !expanded }, shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer) {
            Text(title, modifier = Modifier.padding(14.dp), style = MaterialTheme.typography.titleSmall)
        }
        if (expanded) {
            Column(Modifier.padding(start = 12.dp, top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                row.rows.forEach { child ->
                    key(child.id) { ChatRowView(child, session, onLink, onAlwaysAllow, onOpenTool) }
                }
            }
        }
    }
}

@Composable
private fun ToolDetailDialog(part: ChatPart.Tool, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(part.displayLabel) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(when (part.state) {
                    ChatPart.Tool.State.OutputAvailable -> "Completed"
                    ChatPart.Tool.State.OutputError -> "Failed"
                    ChatPart.Tool.State.OutputDenied -> "Denied"
                    ChatPart.Tool.State.ApprovalRequested -> "Authorization required"
                    else -> "Pending"
                }, style = MaterialTheme.typography.labelLarge)
                Text("Input", style = MaterialTheme.typography.titleSmall)
                Text(part.input?.takeUnless { it.isNull }?.prettyPrinted
                    ?: part.inputText.takeIf { it.isNotBlank() } ?: "No input available")
                Text("Output", style = MaterialTheme.typography.titleSmall)
                Text(part.output?.takeUnless { it.isNull }?.prettyPrinted ?: when (part.state) {
                    ChatPart.Tool.State.OutputDenied -> "Execution was denied."
                    ChatPart.Tool.State.OutputAvailable -> "No output available"
                    ChatPart.Tool.State.OutputError -> "No output available"
                    else -> "Waiting for output"
                })
                if (!part.errorText.isNullOrBlank()) {
                    Text("Error", style = MaterialTheme.typography.titleSmall)
                    Text(part.errorText, color = MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
    )
}

@Composable
private fun DataImage(url: String) {
    val bmp = remember(url) {
        val comma = url.indexOf(',')
        if (comma < 0) null
        else runCatching {
            val data = Base64.decode(url.substring(comma + 1), Base64.DEFAULT)
            BitmapFactory.decodeByteArray(data, 0, data.size)?.asImageBitmap()
        }.getOrNull()
    }
    if (bmp != null) {
        Image(bmp, contentDescription = null, modifier = Modifier.size(96.dp).clip(RoundedCornerShape(14.dp)).padding(bottom = 6.dp), contentScale = ContentScale.Crop)
    }
}
