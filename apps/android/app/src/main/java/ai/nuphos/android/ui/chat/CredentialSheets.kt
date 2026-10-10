package ai.nuphos.android.ui.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.rounded.VerifiedUser
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Checkbox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import ai.nuphos.android.model.CredentialSelection
import ai.nuphos.android.model.PermissionMode
import ai.nuphos.android.ui.LocalAgentStore

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CredentialPickerSheet(
    selection: CredentialSelection,
    onSelectionChange: (CredentialSelection) -> Unit,
    onDismiss: () -> Unit,
) {
    val store = LocalAgentStore.current
    LaunchedEffect(Unit) { store.loadCredentialOptions() }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceBetween) {
            Text("IAM", style = MaterialTheme.typography.headlineSmall)
            Row {
                if (!selection.isEmpty) TextButton(onClick = { onSelectionChange(CredentialSelection()) }) { Text("Clear") }
                TextButton(onClick = onDismiss) { Text("Done") }
            }
        }
        val catalog = store.credentialCatalog
        val error = store.credentialCatalogError
        when {
            catalog == null && error != null -> Text(error, modifier = Modifier.padding(24.dp), color = MaterialTheme.colorScheme.error)
            catalog == null -> Text("Loading IAM…", modifier = Modifier.padding(24.dp))
            catalog.isEmpty -> Text("No computers or IAM available. Connect a computer or cloud account in Nuphos to use it here.", modifier = Modifier.padding(24.dp))
            else -> LazyColumn {
                catalog.sections.forEach { section ->
                    item { Text(section.provider.title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp), color = MaterialTheme.colorScheme.primary) }
                    if (section.provider.optionsKey == "devices") {
                        item { Text("Allow this conversation to operate the computers you select.", modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.bodySmall) }
                    }
                    items(section.items, key = { it.id }) { item ->
                        val computer = section.provider.optionsKey == "devices"
                        ListItem(
                            headlineContent = { Text(item.label) },
                            supportingContent = item.detail?.let { { Text(it) } },
                            trailingContent = {
                                if (computer) Checkbox(checked = selection.contains(item), onCheckedChange = null)
                                else if (selection.contains(item)) Icon(Icons.Outlined.Check, contentDescription = null)
                            },
                            modifier = if (computer) Modifier.toggleable(value = selection.contains(item), role = Role.Checkbox) { onSelectionChange(selection.toggle(item)) }
                                else Modifier.clickable { onSelectionChange(selection.toggle(item)) },
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PermissionModeSheet(
    mode: PermissionMode,
    onSelect: (PermissionMode) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Text("Permission mode", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(16.dp))
        PermissionMode.entries.forEach { option ->
            ListItem(
                headlineContent = { Text(option.title) },
                supportingContent = { Text(option.subtitle) },
                leadingContent = { Icon(if (option == PermissionMode.Bypass) Icons.Rounded.VerifiedUser else Icons.Outlined.Key, contentDescription = null) },
                trailingContent = { if (option == mode) Icon(Icons.Outlined.Check, contentDescription = null) },
                modifier = Modifier.clickable { onSelect(option) },
            )
        }
    }
}
