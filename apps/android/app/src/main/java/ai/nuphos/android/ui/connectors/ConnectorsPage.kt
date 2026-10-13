package ai.nuphos.android.ui.connectors

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import ai.nuphos.android.model.*
import ai.nuphos.android.session.ConnectorsStore
import ai.nuphos.android.ui.LocalConnectorsStore
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectorsPage() {
    val store = LocalConnectorsStore.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var catalog by remember { mutableStateOf(false) }
    var form by remember { mutableStateOf<ConnectorProvider?>(null) }
    LaunchedEffect(store.team?.id) { catalog = false; form = null }
    BackHandler(store.pending != null) { scope.launch { store.cancel() } }
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = { scope.launch { store.refresh() } }, enabled = store.team != null && !store.busy) { Text("Refresh") }
            Button(modifier = Modifier.testTag("connector-catalog"), onClick = { catalog = true }, enabled = store.team != null && !store.busy && store.pending == null) { Text("Providers") }
        }
        if (store.team == null) Text("Select a team to see connectors.")
        if (store.team != null && store.team?.isAdministrator != true) Text("You can browse connectors. A team administrator can add providers.", style = MaterialTheme.typography.bodyMedium)
        store.notice?.let { Text(it, Modifier.padding(vertical = 8.dp)) }
        store.actionError?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(vertical = 8.dp)) }
        store.pending?.let { pending ->
            Card(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text("Waiting for ${ConnectorCatalog.named(pending.provider)?.title ?: pending.provider} authorization.")
                    Text("Returning from the browser does not confirm a connection.", style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { scope.launch { store.cancel() } }, enabled = !store.busy) { Text("Cancel authorization") }
                }
            }
        }
        if (store.busy || store.phase == ConnectorsStore.Phase.Loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (store.phase == ConnectorsStore.Phase.Failed) {
            Text(store.loadError ?: "Could not load connectors.", color = MaterialTheme.colorScheme.error)
            TextButton(onClick = { scope.launch { store.refresh() } }) { Text("Retry") }
        }
        if (store.phase == ConnectorsStore.Phase.Loaded && store.inventory.rows.isEmpty()) Text("No connectors are saved for this team.", Modifier.padding(vertical = 24.dp))
        LazyColumn(modifier = Modifier.testTag("connector-inventory-list"), verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
            items(store.inventory.rows, key = { it.key }) { row ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text(ConnectorCatalog.named(row.provider)?.title ?: row.provider, style = MaterialTheme.typography.labelMedium)
                        Text(row.label, style = MaterialTheme.typography.titleMedium)
                        row.detail?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        ai.nuphos.android.ui.components.TechnicalDetails(row.key) {
                            Text("ID: ${row.bindingId}", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
    if (catalog) {
        ModalBottomSheet(onDismissRequest = { catalog = false }) {
            Text("Providers", Modifier.padding(16.dp), style = MaterialTheme.typography.headlineSmall)
            LazyColumn(modifier = Modifier.testTag("connector-catalog-list"), contentPadding = PaddingValues(bottom = 24.dp)) {
                items(ConnectorCatalog.all, key = { it.key }) { provider ->
                    ListItem(
                        headlineContent = { Text(provider.title) },
                        supportingContent = { Text(if (provider.canAdd) "Available on Android" else "Browse saved connections; set up elsewhere") },
                        trailingContent = {
                            if (provider.canAdd && store.team?.isAdministrator == true) {
                                TextButton(modifier = Modifier.testTag("connector-add-${provider.key}"), enabled = store.canAdd, onClick = {
                                    catalog = false
                                    if (provider.fields.isNotEmpty()) form = provider else scope.launch {
                                        val url = store.start(provider)
                                        if (url != null) {
                                            try {
                                                CustomTabsIntent.Builder().setShareState(CustomTabsIntent.SHARE_STATE_OFF).build().launchUrl(context, Uri.parse(url))
                                            } catch (_: Exception) { store.cancel("The browser could not open. Refresh connectors before trying again.") }
                                        }
                                    }
                                }) { Text("Add") }
                            }
                        },
                    )
                }
            }
        }
    }
    form?.let { provider ->
        ConnectorFormSheet(provider, store, onDismiss = { if (!store.busy) { store.closeForm(); form = null } })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConnectorFormSheet(provider: ConnectorProvider, store: ConnectorsStore, onDismiss: () -> Unit) {
    // remember, never rememberSaveable: secrets are discarded on activity recreation.
    var values by remember(provider.key) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var submitted by remember { mutableStateOf(false) }
    val validation = provider.validate(values)
    val scope = rememberCoroutineScope()
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Text("Add ${provider.title}", Modifier.padding(16.dp), style = MaterialTheme.typography.headlineSmall)
        LazyColumn(modifier = Modifier.testTag("connector-form-list"), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            provider.note?.let { note -> item { Text(note, style = MaterialTheme.typography.bodyMedium) } }
            items(provider.fields, key = { it.key }) { field ->
                val error = if (submitted) validation.errors[field.key] else null
                if (field.kind == ConnectorFieldKind.Region) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("us", "uk").forEach { region ->
                            FilterChip(selected = values[field.key].orEmpty().ifEmpty { "us" } == region, onClick = { values = values + (field.key to region) }, label = { Text(region.uppercase()) }, enabled = !store.busy)
                        }
                    }
                } else OutlinedTextField(
                    value = values[field.key].orEmpty(),
                    onValueChange = { values = values + (field.key to it) },
                    label = { Text(field.title + if (field.required) "" else " (optional)") },
                    singleLine = true,
                    visualTransformation = if (field.kind == ConnectorFieldKind.Secret) PasswordVisualTransformation() else VisualTransformation.None,
                    keyboardOptions = KeyboardOptions(keyboardType = when (field.kind) {
                        ConnectorFieldKind.Secret -> KeyboardType.Password
                        ConnectorFieldKind.Url -> KeyboardType.Uri
                        ConnectorFieldKind.Email -> KeyboardType.Email
                        else -> KeyboardType.Text
                    }),
                    enabled = !store.busy,
                    isError = error != null,
                    supportingText = error?.let { { Text(it) } },
                    modifier = Modifier.fillMaxWidth().testTag("connector-field-${field.key}"),
                )
            }
            store.actionError?.let { error -> item { Text(error, color = MaterialTheme.colorScheme.error) } }
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onDismiss, enabled = !store.busy) { Text("Cancel") }
                    Button(modifier = Modifier.testTag("connector-save"), onClick = {
                        submitted = true
                        if (validation.valid) scope.launch {
                            if (store.bind(provider, values)) { values = emptyMap(); onDismiss() }
                        }
                    }, enabled = store.canAdd) { Text(if (store.busy) "Saving…" else "Save") }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}
