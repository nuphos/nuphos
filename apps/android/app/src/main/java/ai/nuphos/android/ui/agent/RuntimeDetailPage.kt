package ai.nuphos.android.ui.agent

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import ai.nuphos.android.data.RuntimeQuota
import ai.nuphos.android.session.RuntimeDetailStore

/** Shown inside the existing Agent sheet; provider credentials remain in its existing sign-in flow. */
@Composable
fun RuntimeDetailPage(store: RuntimeDetailStore, quota: RuntimeQuota?, onBack: () -> Unit, onSignIn: () -> Unit) {
    val runtime = store.runtime
    var name by remember(store, runtime?.label) { mutableStateOf(runtime?.label.orEmpty()) }
    var confirmRemoval by remember(store) { mutableStateOf(false) }
    LaunchedEffect(store.editable, runtime?.label, runtime?.kind) {
        if (!store.editable) confirmRemoval = false
    }
    DisposableEffect(store) { onDispose { store.close() } }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TextButton(onClick = onBack) { Text("Back to Agents") }
        Text(runtime?.label ?: "Agent", style = MaterialTheme.typography.headlineSmall)
        if (store.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        store.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        store.message?.let { Text(it) }
        if (runtime == null) Text(if (store.removed) "This Agent has been removed." else "This Agent is unavailable.")
        else {
            Text("${runtime.provider} · ${if (runtime.deleting) "Deleting" else runtime.status}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Name", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(name, { name = it }, label = { Text("Agent name") }, singleLine = true,
                enabled = store.editable, modifier = Modifier.fillMaxWidth())
            Button(onClick = { store.rename(name) }, enabled = store.editable && name.trim().length in 1..120 && name.trim() != runtime.label) { Text("Save name") }
            HorizontalDivider()
            Text("Usage", style = MaterialTheme.typography.titleMedium)
            RuntimeUsage(quota)
            HorizontalDivider()
            if (store.canManage) {
                if (runtime.status == "active")
                    OutlinedButton(onClick = onSignIn, enabled = store.editable) { Text("Sign In Again") }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Enabled")
                    Switch(modifier = Modifier.semantics { contentDescription = "Enabled" }, checked = runtime.status == "active", onCheckedChange = store::setEnabled, enabled = store.editable)
                }
                if (runtime.status != "active") Text("Enable this Agent before signing in.")
                TextButton(onClick = { confirmRemoval = true }, enabled = store.editable,
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("Remove Agent") }
            } else Text(when {
                runtime.deleting -> "Removal is in progress. Refresh to check saved state."
                runtime.kind == "local" -> "Manage this Agent and its sign-in on the computer or Box that hosts it."
                runtime.kind == "development" -> "Manage this Agent in its local development configuration."
                else -> "Only workspace administrators can rename, enable, or remove this Agent and manage its sign-in."
            })
        }
        if (!store.reconciled) Text("A request may have reached the server. Refresh saved state before another change.")
        OutlinedButton(onClick = store::refresh, enabled = !store.busy) { Text("Refresh Agent") }
    }
    if (confirmRemoval && runtime != null && store.editable) AlertDialog(
        onDismissRequest = { confirmRemoval = false },
        title = { Text("Remove ${runtime.label}?") },
        text = { Text(if (runtime.kind == "managed")
            "This stops the Agent and permanently deletes its files and sign-in. Your conversation history stays in Nuphos."
            else "This disconnects the Agent. Your conversations stay in Nuphos.") },
        confirmButton = { TextButton(onClick = { confirmRemoval = false; store.remove() },
            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("Remove Agent") } },
        dismissButton = { TextButton(onClick = { confirmRemoval = false }) { Text("Cancel") } },
    )
}
