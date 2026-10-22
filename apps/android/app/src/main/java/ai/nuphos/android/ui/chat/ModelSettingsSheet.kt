package ai.nuphos.android.ui.chat

import ai.nuphos.android.session.ModelSettingsStore
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModelSettingsSheet(store: ModelSettingsStore, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    LaunchedEffect(store) { store.refresh() }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Model", style = MaterialTheme.typography.headlineSmall)
            if (store.loading || store.saving) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (store.pending.isNotEmpty()) {
                Text(if (store.error != null) "Changes have not been applied." else if (store.isPreview) "Updating model settings…" else "Changes apply after this reply.", style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = store::cancelPending, enabled = !store.saving) { Text("Cancel pending changes") }
            }
            store.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (store.error != null || store.config?.options.isNullOrEmpty()) {
                TextButton(onClick = { scope.launch { store.refresh() } }, enabled = !store.loading && !store.saving) { Text("Try again") }
            }
            when (store.config?.status) {
                "offline" -> Text("This runtime is offline. Model settings return when it reconnects.")
                "unsupported" -> Text("This runtime does not offer model settings.")
                "busy" -> if (store.pending.isEmpty()) Text("Changes apply after this reply.")
            }
            store.config?.options?.forEach { option ->
                Text(option.name, style = MaterialTheme.typography.titleSmall)
                option.visibleChoices.forEach { choice ->
                    val selected = (store.pending[option.id] ?: option.currentValue) == choice.value
                    Surface(onClick = { scope.launch { store.select(option.id, choice.value) } }, enabled = store.canEdit, color = MaterialTheme.colorScheme.surface) {
                        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                            RadioButton(selected = selected, onClick = null, enabled = store.canEdit)
                            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                                Text(choice.name)
                                choice.description?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                        }
                    }
                }
            }
            TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) { Text("Done") }
        }
    }
}
