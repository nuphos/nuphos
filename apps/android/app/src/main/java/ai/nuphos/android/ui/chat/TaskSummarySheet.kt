package ai.nuphos.android.ui.chat

import ai.nuphos.android.R
import ai.nuphos.android.data.ConversationTrigger
import ai.nuphos.android.data.ConversationTriggersApi
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.TransferUpload
import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.size
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import kotlinx.coroutines.CancellationException
import ai.nuphos.android.session.ChatSession
import ai.nuphos.android.session.OpenQuestions
import ai.nuphos.android.ui.chats.BotQuestionCard
import ai.nuphos.android.ui.chats.rememberQuestionConnect
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TaskSummarySheet(
    session: ChatSession,
    token: String,
    children: List<AgentConversation>,
    allowed: () -> Boolean,
    onOpen: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val inbox = remember(session, token) { OpenQuestions(OpenQuestions.Api(token, session.teamId)) }
    val scope = rememberCoroutineScope()
    val connect = rememberQuestionConnect(inbox, allowed)
    var selectedId by remember(session) { mutableStateOf<String?>(null) }
    var attempted by remember(inbox) { mutableStateOf(false) }
    var triggers by remember(inbox) { mutableStateOf<List<ConversationTrigger>?>(null) }
    var triggersFailed by remember(inbox) { mutableStateOf(false) }
    var showTriggers by remember(inbox) { mutableStateOf(false) }
    val uriHandler = LocalUriHandler.current
    val childIds = remember(children) { children.mapTo(mutableSetOf()) { it.sessionId } }
    suspend fun refreshTriggers() {
        if (!allowed()) return
        try {
            triggers = ConversationTriggersApi.list(token, session.teamId, session.sessionId)
            triggersFailed = false
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            triggersFailed = true
        }
    }
    val questions = inbox.list.filter { it.sessionId == session.sessionId || it.sessionId in childIds }
    val selected = questions.firstOrNull { it.id == selectedId }
    val snapshot = session.runtimeObservation?.snapshot
    val background = remember(snapshot) { taskSummaryBackground(snapshot) }
    fun closePane() {
        if (selectedId != null) selectedId = null else onDismiss()
    }

    LaunchedEffect(inbox, allowed()) {
        pollTaskSummary(
            allowed,
            { inbox.refresh(); attempted = true },
            { session.refreshResources() },
            { session.refreshDownloads() },
            { refreshTriggers() },
        )
    }
    LaunchedEffect(selectedId, selected) {
        if (selectedId != null && selected == null) selectedId = null
    }
    if (showTriggers && allowed()) {
        ConversationTriggersSheet(token, session.teamId, session.sessionId) {
            showTriggers = false
            scope.launch { refreshTriggers() }
        }
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        BackHandler(enabled = selected != null) { selectedId = null }
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 12.dp).testTag("task-summary"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(if (selected == null) R.string.chat_summary_title else R.string.chat_summary_question),
                    Modifier.weight(1f),
                    style = MaterialTheme.typography.titleLarge,
                )
                IconButton(onClick = ::closePane) {
                    Icon(Icons.Outlined.Close, stringResource(
                        if (selected == null) R.string.chat_summary_close else R.string.chat_summary_close_question,
                    ))
                }
            }
            if (selected != null) {
                key(selected.id) {
                    BotQuestionCard(
                        selected,
                        showsFrom = selected.sessionId != session.sessionId,
                        onOpen = { onOpen(selected.sessionId) },
                        onAnswer = { if (allowed()) inbox.answer(selected, it, scope) },
                        onForm = { if (allowed()) inbox.answer(selected, it, scope) },
                        failure = inbox.failures[selected.id],
                        onConnect = { connect(selected) },
                    )
                }
            } else {
                Text(stringResource(R.string.chat_summary_needs_input), style = MaterialTheme.typography.titleMedium)
                when {
                    !inbox.loaded && !attempted -> CircularProgressIndicator()
                    !inbox.loaded -> TextButton(onClick = { scope.launch { inbox.refresh() } }) {
                        Text(stringResource(R.string.shell_retry))
                    }
                    questions.isEmpty() -> Text(stringResource(R.string.chat_summary_no_questions))
                    else -> questions.forEach { question ->
                        Column(
                            Modifier.fillMaxWidth().clickable { selectedId = question.id }.padding(vertical = 8.dp),
                        ) {
                            Text(question.request.question, style = MaterialTheme.typography.bodyLarge)
                            Text(question.title, style = MaterialTheme.typography.bodySmall)
                            inbox.failures[question.id]?.let { failure ->
                                Text(failure, color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
                if (background.isNotEmpty()) {
                    Text(stringResource(R.string.chat_summary_background), style = MaterialTheme.typography.titleMedium)
                    background.forEach { work ->
                        key(work.id) {
                            var expanded by remember { mutableStateOf(false) }
                            Column(Modifier.fillMaxWidth()) {
                                Column(Modifier.fillMaxWidth().clickable { expanded = !expanded }.padding(vertical = 8.dp)) {
                                    Text(work.title ?: stringResource(R.string.chat_summary_command))
                                    Text(stringResource(R.string.chat_summary_running), style = MaterialTheme.typography.bodySmall)
                                }
                                if (expanded) {
                                    if (work.output.isEmpty()) {
                                        Text(stringResource(R.string.chat_summary_running))
                                    } else {
                                        if (work.outputTruncated) {
                                            Text(
                                                stringResource(R.string.chat_summary_output_truncated),
                                                style = MaterialTheme.typography.bodySmall,
                                            )
                                        }
                                        SelectionContainer {
                                            Text(work.output, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                val changes = session.linkedResources.resources.filter { it.supported }
                if (changes.isNotEmpty()) {
                    Text(stringResource(R.string.chat_summary_changes), style = MaterialTheme.typography.titleMedium)
                    changes.forEach { change ->
                        val url = change.safeUrl
                        SummaryContextRow(change.title, "${change.chip} · ${change.state}",
                            R.drawable.ic_task_summary_git_pull_request, url != null) {
                            if (allowed() && url != null) {
                                runCatching { uriHandler.openUri(url) }
                            }
                        }
                    }
                }
                if (children.isNotEmpty()) {
                    Text(stringResource(R.string.chat_summary_children), style = MaterialTheme.typography.titleMedium)
                    children.forEach { child ->
                        val status = when {
                            questions.any { it.sessionId == child.sessionId } -> R.string.chat_summary_needs_input
                            child.activeRun != null && child.activeRun != JsonValue.Null -> R.string.chat_summary_running
                            else -> R.string.chat_summary_idle
                        }
                        SummaryContextRow(child.displayTitle, stringResource(status),
                            R.drawable.ic_task_summary_layers, enabled = true) {
                            if (allowed()) onOpen(child.sessionId)
                        }
                    }
                }
                if (session.canReadDownloads && session.downloads.isNotEmpty()) {
                    Text(stringResource(R.string.chat_summary_files), style = MaterialTheme.typography.titleMedium)
                    session.downloads.forEach { group ->
                        key(group.groupId) {
                            val canDownload = { allowed() && session.canReadDownloads }
                            TransferCard(
                                TransferUpload(group.groupId, group.files.map { it.fileName }),
                                { session.transferGroup(group.groupId) },
                                canDownload(),
                                canDownload,
                                compact = true,
                            )
                        }
                    }
                }
                Text(stringResource(R.string.chat_summary_triggers), style = MaterialTheme.typography.titleMedium)
                val listedTriggers = triggers
                when {
                    triggersFailed && listedTriggers.isNullOrEmpty() -> TextButton(
                        onClick = { scope.launch { refreshTriggers() } },
                    ) { Text(stringResource(R.string.shell_retry)) }
                    listedTriggers == null -> CircularProgressIndicator()
                    listedTriggers.isEmpty() -> Text(stringResource(R.string.chat_summary_no_triggers))
                    else -> listedTriggers.forEach { trigger ->
                        SummaryContextRow(trigger.name,
                            if (trigger.enabled) trigger.schedule else stringResource(R.string.chat_summary_paused),
                            R.drawable.ic_task_summary_clock, enabled = true) {
                            if (allowed()) showTriggers = true
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SummaryContextRow(title: String, subtitle: String, @DrawableRes icon: Int, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(20.dp))
        Column {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(subtitle, style = MaterialTheme.typography.bodySmall)
        }
    }
}

internal data class TaskSummaryWork(
    val id: String,
    val title: String?,
    val output: String = "",
    val outputTruncated: Boolean = false,
)

private const val MAX_SUMMARY_OUTPUT = 6_000

internal fun taskSummaryBackground(snapshot: JsonValue?): List<TaskSummaryWork> {
    val terminals = snapshot?.get("tools")?.arrayValue.orEmpty().mapNotNull { tool ->
        val terminal = tool["terminal"] ?: return@mapNotNull null
        if (terminal["status"]?.stringValue != "running") return@mapNotNull null
        val id = tool["id"]?.stringValue ?: return@mapNotNull null
        val output = terminal["output"]?.stringValue.orEmpty()
        var start = (output.length - MAX_SUMMARY_OUTPUT).coerceAtLeast(0)
        if (start > 0 && output[start].isLowSurrogate()) start++
        TaskSummaryWork(id, terminal["command"]?.stringValue, output.substring(start), outputTruncated = start > 0)
    }
    val listed = terminals.mapTo(mutableSetOf()) { it.id }
    val finished = setOf("completed", "failed", "cancelled", "stopped")
    val tasks = snapshot?.get("asyncTasks")?.objectValue.orEmpty().toSortedMap().mapNotNull { (key, task) ->
        if (task["state"]?.stringValue in finished || task["toolCallId"]?.stringValue in listed) return@mapNotNull null
        TaskSummaryWork(task["id"]?.stringValue ?: key, task["name"]?.stringValue ?: key)
    }
    return (terminals + tasks).distinctBy { it.id }
}

internal suspend fun pollTaskSummary(allowed: () -> Boolean, vararg reads: suspend () -> Unit) {
    while (allowed()) {
        for (read in reads) {
            if (!allowed()) return
            read()
        }
        delay(20_000)
    }
}
