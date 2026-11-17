package ai.nuphos.android.ui.chat

import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.SelectAll
import androidx.compose.material.icons.outlined.ClearAll
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import ai.nuphos.android.model.CredentialCatalog
import ai.nuphos.android.model.CredentialSelection
import ai.nuphos.android.model.PermissionMode
import ai.nuphos.android.ui.LocalAgentStore

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CredentialPickerSheet(
    selection: CredentialSelection,
    onSelectionChange: (CredentialSelection) -> Unit,
    onDismiss: () -> Unit,
    computersOnly: Boolean = false,
    /** An integration question's providers: only the credentials that answer it are offered. */
    providers: List<String>? = null,
    onConfirm: (() -> Unit)? = null,
) {
    val store = LocalAgentStore.current
    // Observe the immutable catalog projection in the sheet's owner. A result
    // must update the dialog content as well as its loading/layout boundary.
    // Every kind for a new conversation or a stored one; a selection of unknown origin keeps to the
    // older kinds, whose empty list never means "all".
    val catalog = store.credentialCatalog?.let { loaded ->
        if (computersOnly) ai.nuphos.android.model.CredentialCatalog(loaded.sections.filter { it.provider.optionsKey == "devices" })
        else if (selection.newConversation || selection.stored != null) loaded else ai.nuphos.android.model.CredentialCatalog(
            loaded.sections.filter { it.provider in ai.nuphos.android.model.CredentialCatalog.PROVIDERS },
        )
    }?.answering(providers)
    val error = store.credentialCatalogError
    val scope = rememberCoroutineScope()
    // Like iOS, always ask the server when the picker opens: a connector unbound
    // and rebound since launch must not be offered under its old id. The cached
    // catalog stays visible while this refresh is in flight or if it fails.
    LaunchedEffect(store, store.workspaceRevision) { store.loadCredentialOptions(force = true) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = MaterialTheme.colorScheme.background) {
        if (computersOnly) {
            val allSelected = catalog?.let(selection::containsAllComputers) == true
            val actionFontScale = maxOf(androidx.compose.ui.platform.LocalDensity.current.fontScale,
                androidx.compose.ui.platform.LocalConfiguration.current.fontScale)
            val compactActions = actionFontScale >= 1.5f
            val bulkLabel = if (allSelected) stringResource(R.string.composer_clear_all) else stringResource(R.string.composer_select_all)
            val bulkAction = {
                catalog?.let { onSelectionChange(if (allSelected) selection.clearComputers() else selection.selectAllComputers(it)) }
                Unit
            }
            CenterAlignedTopAppBar(
                title = { Text(stringResource(R.string.composer_computers), style = MaterialTheme.typography.titleMedium,
                    maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    modifier = Modifier.testTag("credential-picker-title")) },
                navigationIcon = {
                    if (compactActions) androidx.compose.material3.IconButton(onClick = bulkAction,
                        enabled = catalog != null && !catalog.isEmpty, modifier = Modifier.testTag("computer-picker-bulk")) {
                        Icon(if (allSelected) Icons.Outlined.ClearAll else Icons.Outlined.SelectAll, bulkLabel)
                    } else TextButton(onClick = bulkAction, enabled = catalog != null && !catalog.isEmpty,
                        modifier = Modifier.testTag("computer-picker-bulk")) { Text(bulkLabel, maxLines = 1) }
                },
                actions = {
                    if (compactActions) androidx.compose.material3.IconButton(onClick = onConfirm ?: onDismiss,
                        modifier = Modifier.testTag("computer-picker-done")) { Icon(Icons.Outlined.Check, stringResource(R.string.done)) }
                    else TextButton(onClick = onConfirm ?: onDismiss, modifier = Modifier.testTag("computer-picker-done")) { Text(stringResource(R.string.done), maxLines = 1) }
                },
                expandedHeight = maxOf(64f, 48f * actionFontScale).dp,
                windowInsets = WindowInsets(0, 0, 0, 0),
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        } else {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            // Keep the readable title out of the action buttons' measurement.
            Text(if (computersOnly) stringResource(R.string.composer_choose_computers) else stringResource(R.string.iam),
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.fillMaxWidth().testTag("credential-picker-title"))
            Row(Modifier.fillMaxWidth().testTag("credential-picker-actions"),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    if (!selection.isEmpty) TextButton(onClick = { onSelectionChange(if (computersOnly) selection.clearComputers() else CredentialSelection()) }) { Text(stringResource(R.string.composer_clear)) }
                }
                if (onConfirm != null) TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
                TextButton(onClick = onConfirm ?: onDismiss) { Text(stringResource(R.string.done)) }
            }
        }
        }
        when {
            catalog == null && error != null -> Column(Modifier.padding(24.dp)) {
                Text(error, color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { scope.launch { store.loadCredentialOptions(force = true) } }) { Text(stringResource(R.string.composer_retry)) }
            }
            catalog == null -> Text(if (computersOnly) stringResource(R.string.composer_loading_computers) else stringResource(R.string.composer_loading_iam), modifier = Modifier.padding(24.dp))
            catalog.isEmpty -> Text(if (computersOnly) stringResource(R.string.composer_no_computers) else stringResource(R.string.composer_no_computers_or_iam), modifier = Modifier.padding(24.dp))
            else -> LazyColumn {
                catalog.sections.forEach { section ->
                    val rows = section.items.filter { !it.unavailable || selection.contains(it) }
                    if (rows.isEmpty()) return@forEach
                    item {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceBetween, verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            if (computersOnly) Icon(Icons.Outlined.Computer, null, Modifier.size(18.dp).padding(end = 4.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(when (section.provider.optionsKey) {
                                "devices" -> stringResource(R.string.composer_computers)
                                "onpremClusters" -> stringResource(R.string.storetext_credentials_clusters)
                                "personalCredentials" -> stringResource(R.string.storetext_credentials_personal)
                                else -> section.provider.title
                            }, style = MaterialTheme.typography.titleSmall, color = if (computersOnly) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary, modifier = Modifier.weight(1f).padding(vertical = 8.dp))
                            if (!computersOnly && section.provider.optionsKey == "devices") {
                                val allSelected = selection.containsAllComputers(catalog)
                                TextButton(onClick = {
                                    onSelectionChange(if (allSelected) selection.clearComputers() else selection.selectAllComputers(catalog))
                                }) { Text(if (allSelected) stringResource(R.string.composer_clear_all) else stringResource(R.string.composer_select_all)) }
                            }
                        }
                    }
                    if (!computersOnly && section.provider.optionsKey == "devices") {
                        item { Text(stringResource(R.string.composer_allow_computers), modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp), style = MaterialTheme.typography.bodySmall) }
                    }
                    itemsIndexed(rows, key = { _, item -> item.id }) { index, item ->
                        if (computersOnly) {
                            Surface(Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                                color = MaterialTheme.colorScheme.surface,
                                shape = RoundedCornerShape(
                                    topStart = if (index == 0) 16.dp else 0.dp, topEnd = if (index == 0) 16.dp else 0.dp,
                                    bottomStart = if (index == rows.lastIndex) 16.dp else 0.dp, bottomEnd = if (index == rows.lastIndex) 16.dp else 0.dp)) {
                                Column {
                                    CredentialOptionRow(item, selection, onSelectionChange, circles = true)
                                    if (index < rows.lastIndex) HorizontalDivider(Modifier.padding(horizontal = 16.dp),
                                        thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                                }
                            }
                        } else CredentialOptionRow(item, selection, onSelectionChange)
                    }
                }
            }
        }
    }
}

@Composable
private fun CredentialOptionRow(item: CredentialCatalog.Item, selection: CredentialSelection,
    onSelectionChange: (CredentialSelection) -> Unit, circles: Boolean = false) {
    val computer = item.provider.optionsKey == "devices"
    Row(Modifier.fillMaxWidth()
        .then(if (computer) Modifier.toggleable(value = selection.contains(item), role = Role.Checkbox) { onSelectionChange(selection.toggle(item)) }
        else Modifier.clickable { onSelectionChange(selection.toggle(item)) })
        .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f).testTag("credential-label-${item.id}")) {
            Text(item.label, style = MaterialTheme.typography.bodyLarge)
            item.detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        Box(Modifier.width(48.dp).heightIn(min = 48.dp).testTag("credential-control-${item.id}"), contentAlignment = Alignment.Center) {
            if (circles) Icon(if (selection.contains(item)) Icons.Filled.CheckCircle else Icons.Outlined.RadioButtonUnchecked,
                null, Modifier.size(22.dp), tint = if (selection.contains(item)) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
            else if (computer) Checkbox(checked = selection.contains(item), onCheckedChange = null)
            else if (selection.contains(item)) Icon(Icons.Outlined.Check, contentDescription = null)
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
        Text(stringResource(R.string.composer_permission_mode), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(16.dp))
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
