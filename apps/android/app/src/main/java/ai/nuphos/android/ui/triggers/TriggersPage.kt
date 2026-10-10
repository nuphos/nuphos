package ai.nuphos.android.ui.triggers

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ai.nuphos.android.model.TriggerRow
import ai.nuphos.android.session.BrowsingPhase
import ai.nuphos.android.session.TriggersStore
import ai.nuphos.android.session.TriggerRunsStore
import kotlinx.coroutines.launch

@Composable
fun TriggersPage(
    store: TriggersStore,
    runs: TriggerRunsStore,
    selectedTeamId: String?,
    onOpenRun: (String, String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var query by rememberSaveable(selectedTeamId) { mutableStateOf("") }
    var type by rememberSaveable(selectedTeamId) { mutableStateOf("") }
    var enabled by rememberSaveable(selectedTeamId) { mutableStateOf("") }
    var detailId by rememberSaveable(selectedTeamId) { mutableStateOf<String?>(null) }
    var showingRuns by rememberSaveable(selectedTeamId) { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val detailState = rememberLazyListState()
    val runsState = rememberLazyListState()
    LaunchedEffect(selectedTeamId) {
        if (store.teamId == selectedTeamId && store.phase != BrowsingPhase.Idle) store.refresh()
        else store.select(selectedTeamId)
    }
    val matchesTeam = store.teamId == selectedTeamId
    val rows = if (matchesTeam) store.rows else emptyList()
    val detail = rows.firstOrNull { it.id == detailId }
    BackHandler(detailId != null) { if (showingRuns) showingRuns = false else detailId = null }
    if (detailId != null) {
        LazyColumn(state = if (showingRuns) runsState else detailState, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                TextButton(onClick = { if (showingRuns) showingRuns = false else detailId = null }) { Text(if (showingRuns) "Back to trigger" else "Back to triggers") }
                if (detail == null) Text(if (!matchesTeam || store.phase == BrowsingPhase.Loading) "Loading trigger…" else "Trigger is unavailable. Refresh the list or check your team access.")
                else Text(detail.name, style = MaterialTheme.typography.headlineSmall)
            }
            if (detail != null && !showingRuns) {
                item { TriggerInformation(detail) }
                item {
                    TextButton(onClick = { showingRuns = true }) { Text("Existing runs") }
                }
            }
            if (detail != null && showingRuns) {
                item {
                    Text("Existing runs", style = MaterialTheme.typography.titleMedium)
                    TextButton(onClick = { scope.launch { runs.refresh() } }, enabled = runs.phase != BrowsingPhase.Loading) { Text("Refresh runs") }
                }
                val matchesRun = runs.teamId == selectedTeamId && runs.triggerId == detail.id
                when {
                    !matchesRun || runs.phase == BrowsingPhase.Idle || runs.phase == BrowsingPhase.Loading -> item { Text("Loading runs…") }
                    runs.phase == BrowsingPhase.Denied -> item { Text("Run access denied. Check your team membership.") }
                    runs.phase == BrowsingPhase.Failed && runs.rows.isEmpty() -> item { Text("Could not load runs. ${runs.error.orEmpty()}") }
                    runs.phase == BrowsingPhase.Loaded && runs.rows.isEmpty() -> item { Text("No existing runs") }
                }
                if (matchesRun) {
                    if (runs.stale) item { Text("Stale runs — refresh failed. ${runs.error.orEmpty()}") }
                    items(runs.rows, key = { it.sessionId }) { run ->
                        Card(Modifier.fillMaxWidth().clickable { selectedTeamId?.let { onOpenRun(run.sessionId, it) } }) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(run.displayTitle, style = MaterialTheme.typography.titleMedium)
                                Text("${run.messageCount} messages · ${ai.nuphos.android.model.ChatTime.label(run.lastActiveAt)}", style = MaterialTheme.typography.bodySmall)
                                if (run.activitySource?.linkedSlackThread == true) Text("Slack-linked run", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                    if (runs.hasMore) item { TextButton(onClick = { scope.launch { runs.loadMore() } }, enabled = runs.phase != BrowsingPhase.Loading) { Text("Load more runs") } }
                }
            }
        }
        LaunchedEffect(selectedTeamId, detail?.id, showingRuns) {
            if (showingRuns && detail != null) runs.select(selectedTeamId, detail.id)
        }
        return
    }
    val filtered = rows.filter {
        (type.isEmpty() || it.triggerType == type) && (enabled.isEmpty() || it.enabled == (enabled == "Enabled")) &&
            listOf(it.name, it.cronExpression.orEmpty(), it.executionPrincipalId.orEmpty(), it.watchGroupId.orEmpty()).any { text -> text.contains(query.trim(), true) }
    }
    LazyColumn(state = listState, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            OutlinedTextField(query, { query = it }, label = { Text("Search triggers") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = { query = ""; type = ""; enabled = "" }) { Text("Clear filters") }
                TextButton(onClick = { scope.launch { store.refresh() } }, enabled = matchesTeam && selectedTeamId != null && store.phase != BrowsingPhase.Loading) { Text("Refresh") }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("", "cron", "webhook").forEach { value -> FilterChip(type == value, { type = value }, label = { Text(value.ifEmpty { "All types" }) }) }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("", "Enabled", "Disabled").forEach { value -> FilterChip(enabled == value, { enabled = value }, label = { Text(value.ifEmpty { "Any state" }) }) }
            }
        }
        when {
            selectedTeamId == null -> item { Text("Select a team to view triggers.") }
            !matchesTeam || store.phase == BrowsingPhase.Loading || store.phase == BrowsingPhase.Idle -> item { Text("Loading triggers…") }
            store.phase == BrowsingPhase.Denied -> item { Text("Trigger access denied. Check your team membership.") }
            store.phase == BrowsingPhase.Failed && rows.isEmpty() -> item { Text("Could not load triggers. ${store.error.orEmpty()}") }
        }
        if (matchesTeam && selectedTeamId != null) {
            if (store.stale) item { Text("Stale data — refresh failed. ${store.error.orEmpty()}", color = MaterialTheme.colorScheme.error) }
            if (store.cronEnabled == false) item { Text("Cron scheduler is unavailable", color = MaterialTheme.colorScheme.error) }
            store.schedulerError?.let { error -> item { Text("Scheduler status unavailable: $error") } }
            if (rows.size >= 100) item { Text("This list is capped at 100 items. It may not show every trigger.") }
            if (store.phase == BrowsingPhase.Loaded && rows.isEmpty()) item { Text("No triggers in this team") }
            else if (rows.isNotEmpty() && filtered.isEmpty()) item { Text("No matching triggers") }
            items(filtered, key = { it.id }) { trigger ->
                Card(Modifier.fillMaxWidth().clickable { detailId = trigger.id; showingRuns = false }) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(trigger.name, style = MaterialTheme.typography.titleMedium)
                        Text("${trigger.triggerType} · ${if (trigger.enabled) "Enabled" else "Disabled"}")
                        trigger.cronExpression?.let { Text("Schedule (UTC): $it", style = MaterialTheme.typography.bodySmall) }
                        trigger.watchGroupId?.let { Text("Watch Group: $it", style = MaterialTheme.typography.bodySmall) }
                    }
                }
            }
        }
    }
}

@Composable
private fun TriggerInformation(trigger: TriggerRow) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Type: ${trigger.triggerType}")
        Text("State: ${if (trigger.enabled) "Enabled" else "Disabled"}")
        trigger.cronExpression?.let { Text("Schedule (UTC): $it") }
        trigger.nextRuns.forEach { Text("Next run (UTC): $it") }
        Text("Authorization: ${trigger.authorizationStatus ?: "Not available"}")
        Text("Provider cleanup: ${trigger.providerCleanupStatus ?: "None reported"}")
        trigger.providerHint?.let { Text("Provider: $it") }
        trigger.createdAt?.let { Text("Created: ${friendlyTimestamp(it)}") }
        trigger.updatedAt?.let { Text("Updated: ${friendlyTimestamp(it)}") }
        trigger.expiresAt?.let { Text("Expires: ${friendlyTimestamp(it)}") }
        trigger.lastExecutedAt?.let { Text("Last executed: ${friendlyTimestamp(it)}") }
        ai.nuphos.android.ui.components.TechnicalDetails(trigger.id) {
            Text("Principal: ${trigger.executionPrincipalId ?: "Not available"}")
            trigger.watchGroupId?.let { Text("Watch Group: $it") }
        }
    }
}

private fun friendlyTimestamp(value: String): String = runCatching {
    java.time.format.DateTimeFormatter.ofLocalizedDateTime(java.time.format.FormatStyle.MEDIUM, java.time.format.FormatStyle.SHORT)
        .withZone(java.time.ZoneId.systemDefault()).format(java.time.Instant.parse(value))
}.getOrDefault(value)
