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
import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource

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
            OutlinedTextField(query, { query = it }, label = { Text(stringResource(R.string.monitoring_search)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = { query = ""; provider = ""; status = "" }) { Text(stringResource(R.string.monitoring_clear_filters)) }
                TextButton(onClick = { scope.launch { store.refresh() } }, enabled = matchesTeam && selectedTeamId != null && store.phase != BrowsingPhase.Loading) { Text(stringResource(R.string.monitoring_refresh)) }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(provider.isEmpty(), { provider = "" }, label = { Text(stringResource(R.string.monitoring_all_providers)) })
                rows.map { it.provider }.distinct().forEach { value -> FilterChip(provider == value, { provider = value }, label = { Text(value) }) }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(status.isEmpty(), { status = "" }, label = { Text(stringResource(R.string.monitoring_all_statuses)) })
                rows.distinctBy { it.status }.forEach { value -> FilterChip(status == value.status, { status = value.status }, label = { Text(value.statusLabel) }) }
            }
        }
        when {
            selectedTeamId == null -> item { Text(stringResource(R.string.monitoring_select_team)) }
            !matchesTeam || store.phase == BrowsingPhase.Idle || store.phase == BrowsingPhase.Loading -> item { Text(stringResource(R.string.monitoring_loading)) }
            store.phase == BrowsingPhase.Denied -> item { Text(stringResource(R.string.monitoring_access_denied)) }
            store.phase == BrowsingPhase.Failed && rows.isEmpty() -> item { Text(stringResource(R.string.monitoring_load_failed, store.error.orEmpty())) }
        }
        if (matchesTeam && selectedTeamId != null) {
            if (store.stale) item { Text(stringResource(R.string.monitoring_stale, store.error.orEmpty()), color = MaterialTheme.colorScheme.error) }
            if (store.overview.providerErrors.isNotEmpty()) item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text(stringResource(R.string.monitoring_provider_errors_title), style = MaterialTheme.typography.titleSmall)
                        TextButton(onClick = { showErrors = !showErrors }) {
                            Text(stringResource(if (showErrors) R.string.monitoring_hide_provider_errors else R.string.monitoring_show_provider_errors))
                        }
                        if (showErrors) store.overview.providerErrors.forEach {
                            Text("${it.provider} · ${it.integrationLabel}: ${it.message}", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
            if (store.phase == BrowsingPhase.Loaded && rows.isEmpty()) item {
                Text(stringResource(R.string.monitoring_empty_title), style = MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.monitoring_empty_body))
                TextButton(onClick = onOpenConnectors) { Text(stringResource(R.string.monitoring_open_connectors)) }
            } else if (rows.isNotEmpty() && filtered.isEmpty()) item { Text(stringResource(R.string.monitoring_no_matching_checks)) }
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
            Text(stringResource(R.string.monitoring_detail_status, row.statusLabel))
            Text(stringResource(R.string.monitoring_detail_provider, row.provider))
            Text(stringResource(R.string.monitoring_detail_connector, row.integrationLabel))
            row.lastIncidentAt?.let {
                val label = runCatching { ai.nuphos.android.model.ChatTime.label(java.time.Instant.parse(it)) }.getOrDefault(it)
                Text(stringResource(R.string.monitoring_detail_last_incident, label))
            }
            ai.nuphos.android.ui.components.TechnicalDetails(row.id) {
                Text(stringResource(R.string.monitoring_detail_kind, row.kind))
                Text(stringResource(R.string.monitoring_detail_resource, row.providerResourceId))
                row.target?.let { Text(stringResource(R.string.monitoring_detail_target, it)) }
            }
            if (url != null) TextButton(onClick = { linkError = runCatching { uriHandler.openUri(url) }.isFailure }) { Text(stringResource(R.string.monitoring_open_provider)) }
            if (linkError) Text(stringResource(R.string.monitoring_open_provider_failed))
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.monitoring_close)) }
        }
    }
}
