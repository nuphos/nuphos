package ai.nuphos.android.ui.chat

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
    if (queue.items.isEmpty() && queue.error == null && queue.recoveredText == null) return
    Surface(Modifier.fillMaxWidth().padding(horizontal = 12.dp), shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceContainerHigh) {
        Column(Modifier.padding(8.dp).heightIn(max = 210.dp).verticalScroll(rememberScrollState())) {
            Text("Queued messages", style = MaterialTheme.typography.labelLarge)
            queue.error?.let { problem ->
                Text(problem, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { scope.launch { queue.refresh() } }, enabled = queue.busy.isEmpty()) { Text("Refresh queue") }
            }
            queue.recoveredText?.let { text ->
                Text("Taken back. Restore this text before leaving the conversation.", style = MaterialTheme.typography.bodySmall)
                androidx.compose.foundation.text.selection.SelectionContainer { Text(text.text) }
                if (text.files.isNotEmpty()) Text(text.files.joinToString(", ") { it.filename ?: "Queued attachment" })
                TextButton(onClick = { queue.restoreRecovered(onRecall) }) { Text("Restore draft") }
            }
            queue.items.forEachIndexed { index, item ->
                Column(Modifier.testTag("server-queued:${item.id}")) {
                    Text("${index + 1}. ${item.text}", maxLines = 3, style = MaterialTheme.typography.bodySmall)
                    Row {
                        val available = writable && queue.busy.isEmpty()
                        TextButton(enabled = available && queue.recoveredText == null, onClick = { scope.launch { queue.take(item.id, onRecall) } }) { Text("Edit") }
                        TextButton(enabled = available, onClick = { scope.launch { queue.take(item.id) } }) { Text("Remove") }
                        TextButton(enabled = available && canSteer, onClick = { scope.launch { queue.sendIntoTurn(item.id) } }) { Text("Send into turn") }
                    }
                }
            }
        }
    }
}
