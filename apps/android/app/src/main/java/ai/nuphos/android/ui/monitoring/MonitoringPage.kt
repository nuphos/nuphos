package ai.nuphos.android.ui.monitoring

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import ai.nuphos.android.model.MonitoringRow
import ai.nuphos.android.model.providerHttpsUrl
import ai.nuphos.android.session.BrowsingPhase
import ai.nuphos.android.session.MonitoringStore
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MonitoringPage(store: MonitoringStore, selectedTeamId: String?, onOpenConnectors: () -> Unit) {
    val scope = rememberCoroutineScope()
    var query by rememberSaveable(selectedTeamId) { mutableStateOf("") }
    var provider by rememberSaveable(selectedTeamId) { mutableStateOf("") }
    var status by rememberSaveable(selectedTeamId) { mutableStateOf("") }
    var detailId by rememberSaveable(selectedTeamId) { mutableStateOf<String?>(null) }
    val listState = rememberLazyListState()
    var showErrors by remember(selectedTeamId) { mutableStateOf(false) }
    LaunchedEffect(selectedTeamId) {
        if (store.teamId == selectedTeamId && store.phase != BrowsingPhase.Idle) store.refresh()
        else store.select(selectedTeamId)
    }
    // Selection changes hide all old-team data before the suspend effect runs.
    val matchesTeam = store.teamId == selectedTeamId
    val rows = if (matchesTeam) store.overview.rows else emptyList()
    val filtered = rows.filter {
        (provider.isEmpty() || it.provider == provider) && (status.isEmpty() || it.status == status) &&
            listOf(it.name, it.integrationLabel, it.target.orEmpty(), it.statusLabel).any { value -> value.contains(query.trim(), true) }
    }
    LazyColumn(state = listState, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            OutlinedTextField(query, { query = it }, label = { Text("Search monitoring") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = { query = ""; provider = ""; status = "" }) { Text("Clear filters") }
                TextButton(onClick = { scope.launch { store.refresh() } }, enabled = matchesTeam && selectedTeamId != null && store.phase != BrowsingPhase.Loading) { Text("Refresh") }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(provider.isEmpty(), { provider = "" }, label = { Text("All providers") })
                rows.map { it.provider }.distinct().forEach { value -> FilterChip(provider == value, { provider = value }, label = { Text(value) }) }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(status.isEmpty(), { status = "" }, label = { Text("All statuses") })
                rows.distinctBy { it.status }.forEach { value -> FilterChip(status == value.status, { status = value.status }, label = { Text(value.statusLabel) }) }
            }
        }
        when {
            selectedTeamId == null -> item { Text("Select a team to view monitoring.") }
            !matchesTeam || store.phase == BrowsingPhase.Idle || store.phase == BrowsingPhase.Loading -> item { Text("Loading monitoring…") }
            store.phase == BrowsingPhase.Denied -> item { Text("Monitoring access denied. Check your team membership.") }
            store.phase == BrowsingPhase.Failed && rows.isEmpty() -> item { Text("Could not load monitoring. ${store.error.orEmpty()}") }
        }
        if (matchesTeam && selectedTeamId != null) {
            if (store.stale) item { Text("Stale data — refresh failed. ${store.error.orEmpty()}", color = MaterialTheme.colorScheme.error) }
            if (store.overview.providerErrors.isNotEmpty()) item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text("Some providers could not be loaded", style = MaterialTheme.typography.titleSmall)
                        TextButton(onClick = { showErrors = !showErrors }) {
                            Text(if (showErrors) "Hide provider errors" else "Show provider errors")
                        }
                        if (showErrors) store.overview.providerErrors.forEach {
                            Text("${it.provider} · ${it.integrationLabel}: ${it.message}", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
            if (store.phase == BrowsingPhase.Loaded && rows.isEmpty()) item {
                Text("No monitoring checks", style = MaterialTheme.typography.titleMedium)
                Text("Supported checks from Better Stack, Grafana and GCP appear here.")
                TextButton(onClick = onOpenConnectors) { Text("Open Connectors") }
            } else if (rows.isNotEmpty() && filtered.isEmpty()) item { Text("No matching checks") }
            items(filtered, key = { it.id }) { row ->
                Card(Modifier.fillMaxWidth().clickable { detailId = row.id }) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(row.name, style = MaterialTheme.typography.titleMedium)
                        Text(row.statusLabel, style = MaterialTheme.typography.labelLarge)
                        Text("${row.provider} · ${row.integrationLabel}", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
    rows.firstOrNull { it.id == detailId }?.let { row -> MonitoringInformation(row) { detailId = null } }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MonitoringInformation(row: MonitoringRow, onDismiss: () -> Unit) {
    val uriHandler = LocalUriHandler.current
    val url = providerHttpsUrl(row.providerUrl)
    var linkError by remember(row.id) { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(row.name, style = MaterialTheme.typography.headlineSmall)
            Text("Status: ${row.statusLabel}")
            Text("Provider: ${row.provider}")
            Text("Connector: ${row.integrationLabel}")
            row.lastIncidentAt?.let {
                val label = runCatching { ai.nuphos.android.model.ChatTime.label(java.time.Instant.parse(it)) }.getOrDefault(it)
                Text("Last incident: $label")
            }
            ai.nuphos.android.ui.components.TechnicalDetails(row.id) {
                Text("Kind: ${row.kind}")
                Text("Resource: ${row.providerResourceId}")
                row.target?.let { Text("Target: $it") }
            }
            if (url != null) TextButton(onClick = { linkError = runCatching { uriHandler.openUri(url) }.isFailure }) { Text("Open provider") }
            if (linkError) Text("Could not open the provider link.")
            TextButton(onClick = onDismiss) { Text("Close") }
        }
    }
}
