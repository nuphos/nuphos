package ai.nuphos.android.ui.chat

import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import ai.nuphos.android.session.ServerQueueStore
import kotlinx.coroutines.launch

@Composable
internal fun ServerQueuedMessages(queue: ServerQueueStore, writable: Boolean, canSteer: Boolean, onRecall: (ai.nuphos.android.data.AgentChatApi.QueueRecall) -> Boolean) {
    val scope = rememberCoroutineScope()
    if (!queue.shown) return
    Surface(Modifier.fillMaxWidth().padding(horizontal = 12.dp), shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceContainerHigh) {
        Column(Modifier.padding(8.dp).heightIn(max = 210.dp).verticalScroll(rememberScrollState())) {
            Text(stringResource(R.string.composer_queued_messages), style = MaterialTheme.typography.labelLarge)
            usageHoldNotice(queue.held)?.let { notice ->
                Text(stringResource(notice.text, *notice.args.toTypedArray()), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.testTag("server-queue-held"))
            }
            queue.error?.let { problem ->
                Text(problem, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { scope.launch { queue.refresh() } }, enabled = queue.busy.isEmpty()) { Text(stringResource(R.string.composer_refresh_queue)) }
            }
            queue.recoveredText?.let { text ->
                Text(stringResource(R.string.composer_taken_back), style = MaterialTheme.typography.bodySmall)
                androidx.compose.foundation.text.selection.SelectionContainer { Text(text.text) }
                if (text.files.isNotEmpty()) {
                    val queuedAttachment = stringResource(R.string.composer_queued_attachment)
                    Text(text.files.joinToString(", ") { it.filename ?: queuedAttachment })
                }
                TextButton(onClick = { queue.restoreRecovered(onRecall) }) { Text(stringResource(R.string.composer_restore_draft)) }
            }
            queue.items.forEachIndexed { index, item ->
                Column(Modifier.testTag("server-queued:${item.id}")) {
                    Text("${index + 1}. ${item.text}", maxLines = 3, style = MaterialTheme.typography.bodySmall)
                    Row {
                        val available = writable && queue.busy.isEmpty()
                        TextButton(enabled = available && queue.recoveredText == null, onClick = { scope.launch { queue.take(item.id, onRecall) } }) { Text(stringResource(R.string.composer_edit)) }
                        TextButton(enabled = available, onClick = { scope.launch { queue.take(item.id) } }) { Text(stringResource(R.string.composer_remove)) }
                        TextButton(enabled = available && canSteer, onClick = { scope.launch { queue.sendIntoTurn(item.id) } }) { Text(stringResource(R.string.composer_send_into_turn)) }
                    }
                }
            }
        }
    }
}

/** The strip's status line while the agent's usage limit holds the queue, as on Desktop. */
internal data class UsageHoldNotice(val text: Int, val args: List<Int> = emptyList())

internal fun usageHoldNotice(held: ai.nuphos.android.data.AgentChatApi.UsageHold?, now: java.time.Instant = java.time.Instant.now()): UsageHoldNotice? {
    held ?: return null
    val reset = ai.nuphos.android.ui.agent.ResetsIn.of(held.until, now)
        ?: return UsageHoldNotice(R.string.composer_queue_usage_held)
    return when {
        reset.days > 0 -> UsageHoldNotice(R.string.composer_queue_usage_held_days, listOf(reset.days.toInt(), reset.hours.toInt()))
        reset.hours > 0 -> UsageHoldNotice(R.string.composer_queue_usage_held_hours, listOf(reset.hours.toInt(), reset.minutes.toInt()))
        else -> UsageHoldNotice(R.string.composer_queue_usage_held_minutes, listOf(reset.minutes.toInt()))
    }
}
