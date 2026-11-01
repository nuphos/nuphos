package ai.nuphos.android.ui.connectors

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.*
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.nuphos.android.model.*
import ai.nuphos.android.session.ConnectorsStore
import ai.nuphos.android.ui.LocalConnectorsStore
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectorsPage() {
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    val store = LocalConnectorsStore.current
    val context = LocalContext.current
    val logoLoader = rememberConnectorImageLoader()
    val scope = rememberCoroutineScope()
    var catalog by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var form by remember { mutableStateOf<ConnectorProvider?>(null) }
    LaunchedEffect(store.team?.id) { catalog = false; form = null; query = "" }
    BackHandler(store.pending != null) { scope.launch { store.cancel() } }
    fun openCatalog() { if (store.canAdd) { query = ""; catalog = true } }
    fun add(provider: ConnectorProvider) {
        if (!store.canAdd || !provider.canAdd) return
        catalog = false
        if (provider.fields.isNotEmpty()) form = provider else scope.launch {
            val url = store.start(provider)
            if (url != null) {
                try { CustomTabsIntent.Builder().setShareState(CustomTabsIntent.SHARE_STATE_OFF).build().launchUrl(context, Uri.parse(url)) }
                catch (_: Exception) { store.cancel("The browser could not open. Refresh connectors before trying again.") }
            }
        }
    }
    PullToRefreshBox(isRefreshing = store.phase == ConnectorsStore.Phase.Loading && store.inventory.rows.isNotEmpty(),
        onRefresh = { if (store.team != null && !store.busy) scope.launch { store.refresh() } },
        modifier = Modifier.fillMaxSize()) {
        LazyColumn(modifier = Modifier.fillMaxSize().testTag("connector-inventory-list"),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp)) {
            item {
                if (store.team == null) Text("Select a team to see connectors.")
                store.notice?.let { Text(it, Modifier.padding(vertical = 8.dp)) }
                store.actionError?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(vertical = 8.dp)) }
                store.pending?.let { pending ->
                    Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface) {
                        Column(Modifier.padding(16.dp)) {
                            Text("Waiting for ${ConnectorCatalog.named(pending.provider)?.title ?: pending.provider} authorization.")
                            Text("Returning from the browser does not confirm a connection.", style = MaterialTheme.typography.bodySmall)
                            TextButton(onClick = { scope.launch { store.cancel() } }, enabled = !store.busy) { Text("Cancel authorization") }
                        }
                    }
                }
                if (store.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (store.phase == ConnectorsStore.Phase.Failed) {
                    Text(store.loadError ?: "Could not load connectors.", color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = { scope.launch { store.refresh() } }) { Text("Retry") }
                }
            }
            if (store.phase == ConnectorsStore.Phase.Loading && store.inventory.rows.isEmpty()) item {
                Box(Modifier.fillMaxWidth().height(320.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            }
            if (store.phase == ConnectorsStore.Phase.Loaded && store.inventory.rows.isEmpty()) item {
                Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 72.dp),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Icon(Icons.Outlined.Link, null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("No connectors yet", style = MaterialTheme.typography.titleLarge)
                    Text(if (store.team?.isAdministrator == true) "Connect a cloud account or an integration to let the agent work in it."
                        else "A team administrator can connect cloud accounts and integrations.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (store.team?.isAdministrator == true) Button(onClick = ::openCatalog, enabled = store.canAdd, modifier = Modifier.testTag("connector-catalog")) {
                        Icon(Icons.Default.Add, null); Spacer(Modifier.width(8.dp)); Text("Add connector")
                    }
                }
            }
            val providerOrder = ConnectorCatalog.all.mapIndexed { index, provider -> provider.key to index }.toMap()
            val groups = store.inventory.rows.sortedBy { providerOrder[it.provider] ?: Int.MAX_VALUE }
                .groupBy { ConnectorCatalog.named(it.provider)?.category ?: "Other" }
            ConnectorCatalog.categoryOrder.forEach { category ->
                val rows = groups[category].orEmpty()
                if (rows.isNotEmpty()) {
                    item(key = "category:$category") { ConnectorCategoryTitle(category) }
                    itemsIndexed(rows, key = { _, row -> row.key }) { index, row ->
                        Surface(color = MaterialTheme.colorScheme.surface, shape = connectorRowShape(index, rows.size),
                            modifier = Modifier.fillMaxWidth().pointerInput(row.key) { detectTapGestures(onLongPress = { clipboard.setText(androidx.compose.ui.text.AnnotatedString(row.bindingId)) }) }
                                .semantics { customActions = listOf(CustomAccessibilityAction("Copy connector ID") { clipboard.setText(androidx.compose.ui.text.AnnotatedString(row.bindingId)); true }) }) {
                            Column {
                                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp).heightIn(min = 36.dp),
                                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    ConnectorLogo(row.provider, logoLoader)
                                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                        Text(row.label, fontSize = 15.sp, lineHeight = 20.sp)
                                        Text(row.detail ?: ConnectorCatalog.named(row.provider)?.title ?: row.provider,
                                            fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
                                    }
                                }
                                if (index < rows.lastIndex) HorizontalDivider(Modifier.padding(start = 48.dp), color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f))
                            }
                        }
                    }
                }
            }
            if (store.inventory.rows.isNotEmpty() && store.team?.isAdministrator == true) item {
                Spacer(Modifier.height(20.dp))
                Surface(onClick = ::openCatalog, enabled = store.canAdd, color = MaterialTheme.colorScheme.surface,
                    shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth().testTag("connector-catalog")) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(Icons.Default.Add, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                        Text("Add connector", fontSize = 15.sp, color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
    if (catalog) {
        ModalBottomSheet(onDismissRequest = { catalog = false }, containerColor = MaterialTheme.colorScheme.background,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
            Column(Modifier.fillMaxWidth().heightIn(max = 720.dp).fillMaxHeight().testTag("connector-catalog-panel")) {
                Box(Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                    Text("Add connector", Modifier.align(Alignment.Center).padding(horizontal = 72.dp), style = MaterialTheme.typography.titleMedium)
                    TextButton(onClick = { catalog = false }, modifier = Modifier.align(Alignment.CenterEnd)) { Text("Done") }
                }
                OutlinedTextField(query, { query = it }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).testTag("connector-search"),
                    placeholder = { Text("Search connectors") }, singleLine = true,
                    leadingIcon = { Icon(Icons.Outlined.Search, null) },
                    trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Outlined.Close, "Clear connector search") } })
                val needle = query.trim()
                val providers = ConnectorCatalog.all.filter { it.canAdd && (needle.isEmpty() || it.title.contains(needle, ignoreCase = true) || it.key.contains(needle, ignoreCase = true)) }
                LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("connector-catalog-list"), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)) {
                    if (providers.isEmpty()) item { Text("No connectors found", Modifier.fillMaxWidth().padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    ConnectorCatalog.categoryOrder.forEach { category ->
                        val entries = providers.filter { it.category == category }
                        if (entries.isNotEmpty()) {
                            item(key = "catalog:$category") { ConnectorCategoryTitle(category) }
                            itemsIndexed(entries, key = { _, provider -> provider.key }) { index, provider ->
                                Surface(onClick = { add(provider) }, enabled = store.canAdd, color = MaterialTheme.colorScheme.surface,
                                    shape = connectorRowShape(index, entries.size), modifier = Modifier.fillMaxWidth().testTag("connector-add-${provider.key}")) {
                                    Column {
                                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp).heightIn(min = 28.dp),
                                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                            ConnectorLogo(provider.key, logoLoader)
                                            Text(provider.title, Modifier.weight(1f), fontSize = 15.sp)
                                            Icon(if (provider.oauth || provider.key == "github") Icons.Outlined.NorthEast else Icons.Outlined.ChevronRight,
                                                if (provider.oauth || provider.key == "github") "Opens browser authorization" else "Open connection form",
                                                modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                        if (index < entries.lastIndex) HorizontalDivider(Modifier.padding(start = 48.dp), color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    form?.let { provider -> ConnectorFormSheet(provider, store,
        onDismiss = { if (!store.busy) { store.closeForm(); form = null } },
        onBack = { if (!store.busy) { store.closeForm(); form = null; catalog = true } }) }
}

private fun connectorRowShape(index: Int, size: Int) = RoundedCornerShape(
    topStart = if (index == 0) 20.dp else 0.dp, topEnd = if (index == 0) 20.dp else 0.dp,
    bottomStart = if (index == size - 1) 20.dp else 0.dp, bottomEnd = if (index == size - 1) 20.dp else 0.dp)

@Composable
private fun ConnectorCategoryTitle(title: String) {
    Text(title, Modifier.padding(start = 12.dp, top = 20.dp, bottom = 8.dp), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConnectorFormSheet(provider: ConnectorProvider, store: ConnectorsStore, onDismiss: () -> Unit, onBack: () -> Unit) {
    // Secrets are ephemeral and are discarded when this form leaves composition.
    var values by remember(provider.key) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var submitted by remember { mutableStateOf(false) }
    val validation = provider.validate(values)
    val scope = rememberCoroutineScope()
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = MaterialTheme.colorScheme.background,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().heightIn(max = 720.dp).fillMaxHeight().testTag("connector-form-panel")) {
            Box(Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                IconButton(onClick = onBack, enabled = !store.busy, modifier = Modifier.align(Alignment.CenterStart)) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to Add connector")
                }
                Text(provider.title, Modifier.align(Alignment.Center).padding(horizontal = 88.dp), style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = onDismiss, enabled = !store.busy, modifier = Modifier.align(Alignment.CenterEnd)) { Text("Cancel") }
            }
            HorizontalDivider()
            LazyColumn(modifier = Modifier.weight(1f).fillMaxWidth().testTag("connector-form-list"),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(provider.fields, key = { it.key }) { field ->
                    val error = if (submitted) validation.errors[field.key] else null
                    if (field.kind == ConnectorFieldKind.Region) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf("us", "uk").forEach { region ->
                                FilterChip(selected = values[field.key].orEmpty().ifEmpty { "us" } == region,
                                    onClick = { values = values + (field.key to region) }, label = { Text(region.uppercase()) }, enabled = !store.busy)
                            }
                        }
                    } else OutlinedTextField(
                        value = values[field.key].orEmpty(), onValueChange = { values = values + (field.key to it) },
                        label = { Text(field.title + if (field.required) "" else " (optional)") }, singleLine = true,
                        visualTransformation = if (field.kind == ConnectorFieldKind.Secret) PasswordVisualTransformation() else VisualTransformation.None,
                        keyboardOptions = KeyboardOptions(keyboardType = when (field.kind) {
                            ConnectorFieldKind.Secret -> KeyboardType.Password
                            ConnectorFieldKind.Url -> KeyboardType.Uri
                            ConnectorFieldKind.Email -> KeyboardType.Email
                            else -> KeyboardType.Text
                        }), enabled = !store.busy, isError = error != null, supportingText = error?.let { { Text(it) } },
                        modifier = Modifier.fillMaxWidth().testTag("connector-field-${field.key}"))
                }
                provider.note?.let { note -> item { Text(note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
                store.actionError?.let { error -> item { Text(error, color = MaterialTheme.colorScheme.error) } }
                item {
                    Button(modifier = Modifier.fillMaxWidth().testTag("connector-save"), onClick = {
                        submitted = true
                        if (validation.valid) scope.launch { if (store.bind(provider, values)) { values = emptyMap(); onDismiss() } }
                    }, enabled = store.canAdd) { Text(if (store.busy) "Connecting…" else "Connect") }
                }
                item { Spacer(Modifier.height(24.dp)) }
            }
        }
    }
}
