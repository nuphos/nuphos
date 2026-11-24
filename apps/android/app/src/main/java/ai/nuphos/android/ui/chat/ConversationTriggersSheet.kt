package ai.nuphos.android.ui.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import ai.nuphos.android.data.ConversationTrigger
import ai.nuphos.android.data.ConversationTriggersApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationTriggersSheet(
    token: String, team: String, session: String,
    /** Starts a message asking the agent to change a Trigger; without one, the details say to ask in the conversation. */
    onEdit: ((String) -> Unit)? = null,
    onDismiss: () -> Unit,
) {
    var opened by remember(token, team, session) { mutableStateOf<String?>(null) }
    var triggers by remember(token, team, session) { mutableStateOf<List<ConversationTrigger>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var failure by remember { mutableStateOf<String?>(null) }
    var pending by remember { mutableStateOf<Set<String>>(emptySet()) }
    var revision by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    val loadFailed = stringResource(R.string.chat_triggers_load_failed)
    val updateFailed = stringResource(R.string.chat_triggers_update_failed)
    suspend fun reload() {
        try {
            val requested = revision
            val rows = ConversationTriggersApi.list(token, team, session)
            if (requested != revision) return
            triggers = rows
            failure = null
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { failure = e.message ?: loadFailed }
        finally { loading = false }
    }
    LaunchedEffect(token, team, session) { while (true) { reload(); delay(30_000) } }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        val openedTrigger = triggers.firstOrNull { it.id == opened }
        BackHandler(enabled = openedTrigger != null) { opened = null }
        if (openedTrigger != null) TriggerDetails(openedTrigger, onBack = { opened = null }, onEdit = onEdit?.let { edit -> { draft: String -> edit(draft); onDismiss() } })
        else Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(stringResource(R.string.chat_triggers_title), style = MaterialTheme.typography.titleLarge)
            if (loading) CircularProgressIndicator()
            failure?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (!loading && triggers.isEmpty() && failure == null) Text(stringResource(R.string.chat_triggers_empty))
            triggers.forEach { trigger ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    // The row opens what the Trigger sends; the switch beside it stays a separate control.
                    Column(Modifier.weight(1f).clickable(role = Role.Button) { opened = trigger.id }.testTag("trigger-row-${trigger.id}"),
                        verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(trigger.name, style = MaterialTheme.typography.titleSmall)
                        Text(trigger.schedule, style = MaterialTheme.typography.bodySmall)
                        Text(nextRunLabel(trigger), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    val enableLabel = stringResource(R.string.chat_trigger_enable, trigger.name)
                    Switch(checked = trigger.enabled, enabled = trigger.canManage && trigger.id !in pending,
                        modifier = Modifier.semantics { contentDescription = enableLabel },
                        onCheckedChange = { enabled ->
                            if (trigger.id !in pending) {
                                pending = pending + trigger.id
                                scope.launch {
                                    try {
                                        ConversationTriggersApi.toggle(token, team, trigger.id, enabled)
                                        revision++
                                        reload()
                                    } catch (e: CancellationException) { throw e }
                                    catch (e: Exception) { failure = e.message ?: updateFailed }
                                    finally { pending = pending - trigger.id }
                                }
                            }
                        })
                }
            }
            TextButton(onClick = { scope.launch { reload() } }) { Text(stringResource(R.string.chat_triggers_refresh)) }
        }
    }
}

@Composable
private fun nextRunLabel(trigger: ConversationTrigger): String {
    val next = trigger.nextRunAt?.let { runCatching {
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault()).format(Instant.parse(it))
    }.getOrNull() }
    return when {
        !trigger.enabled -> stringResource(R.string.chat_trigger_paused)
        next != null -> stringResource(R.string.chat_trigger_next_run, next)
        trigger.triggerType == "webhook" -> stringResource(R.string.chat_trigger_waiting_webhook)
        else -> stringResource(R.string.chat_trigger_no_upcoming_runs)
    }
}

/** What a Trigger sends and when; Edit hands a message for the agent to the composer, since the agent changes Triggers. */
@Composable
private fun TriggerDetails(trigger: ConversationTrigger, onBack: () -> Unit, onEdit: ((String) -> Unit)?) {
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = stringResource(R.string.chat_back)) }
            Text(trigger.name, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
        }
        Column(Modifier.padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            SelectionContainer {
                Text(trigger.messageTemplate.orEmpty(), Modifier.testTag("trigger-instruction"),
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            HorizontalDivider()
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(trigger.schedule, style = MaterialTheme.typography.bodyMedium)
                Text(nextRunLabel(trigger), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            HorizontalDivider()
            if (onEdit != null) {
                val draft = stringResource(R.string.chat_trigger_edit_draft, trigger.name)
                TextButton(onClick = { onEdit(draft) }, Modifier.testTag("trigger-edit")) { Text(stringResource(R.string.chat_trigger_edit)) }
            } else {
                Text(stringResource(R.string.chat_trigger_ask_to_change), style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
