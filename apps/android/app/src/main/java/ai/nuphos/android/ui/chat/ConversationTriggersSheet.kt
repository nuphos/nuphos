package ai.nuphos.android.ui.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationTriggersSheet(token: String, team: String, session: String, onDismiss: () -> Unit) {
    var triggers by remember(token, team, session) { mutableStateOf<List<ConversationTrigger>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var failure by remember { mutableStateOf<String?>(null) }
    var pending by remember { mutableStateOf<Set<String>>(emptySet()) }
    val scope = rememberCoroutineScope()
    suspend fun reload() {
        try {
            triggers = ConversationTriggersApi.list(token, team, session)
            failure = null
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { failure = e.message ?: "Could not load triggers" }
        finally { loading = false }
    }
    LaunchedEffect(token, team, session) { while (true) { reload(); delay(30_000) } }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Triggers", style = MaterialTheme.typography.titleLarge)
            if (loading) CircularProgressIndicator()
            failure?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (!loading && triggers.isEmpty() && failure == null) Text("Ask the agent to schedule recurring work in this conversation.")
            triggers.forEach { trigger ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(trigger.name, style = MaterialTheme.typography.titleSmall)
                        Text(trigger.schedule, style = MaterialTheme.typography.bodySmall)
                        val next = trigger.nextRunAt?.let { runCatching {
                            DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault()).format(Instant.parse(it))
                        }.getOrNull() }
                        Text(if (!trigger.enabled) "Paused" else if (next != null) "Next: $next" else if (trigger.triggerType == "webhook") "Waiting for webhook" else "No upcoming runs",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(checked = trigger.enabled, enabled = trigger.canManage && trigger.id !in pending,
                        modifier = Modifier.semantics { contentDescription = "Enable ${trigger.name}" },
                        onCheckedChange = { enabled ->
                            if (trigger.id !in pending) {
                                pending = pending + trigger.id
                                scope.launch {
                                    try {
                                        ConversationTriggersApi.toggle(token, team, trigger.id, enabled)
                                        reload()
                                    } catch (e: CancellationException) { throw e }
                                    catch (e: Exception) { failure = e.message ?: "Could not update trigger" }
                                    finally { pending = pending - trigger.id }
                                }
                            }
                        })
                }
            }
            TextButton(onClick = { scope.launch { reload() } }) { Text("Refresh") }
        }
    }
}
