package ai.nuphos.android.ui.agent

import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource
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
        TextButton(onClick = onBack) { Text(stringResource(R.string.agent_back_to_runtimes)) }
        Text(runtime?.label ?: stringResource(R.string.agent_runtime), style = MaterialTheme.typography.headlineSmall)
        if (store.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        store.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        store.message?.let { Text(it) }
        if (runtime == null) Text(stringResource(if (store.removed) R.string.agent_runtime_removed else R.string.agent_runtime_is_unavailable))
        else {
            Text("${runtime.provider} · ${if (runtime.deleting) stringResource(R.string.agent_deleting) else runtime.status}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(stringResource(R.string.agent_name), style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(name, { name = it }, label = { Text(stringResource(R.string.agent_runtime_name)) }, singleLine = true,
                enabled = store.editable, modifier = Modifier.fillMaxWidth())
            Button(onClick = { store.rename(name) }, enabled = store.editable && name.trim().length in 1..120 && name.trim() != runtime.label) { Text(stringResource(R.string.agent_save_name)) }
            HorizontalDivider()
            Text(stringResource(R.string.agent_usage), style = MaterialTheme.typography.titleMedium)
            RuntimeUsage(quota)
            HorizontalDivider()
            if (store.canManage) {
                if (runtime.status == "active")
                    OutlinedButton(onClick = onSignIn, enabled = store.editable) { Text(stringResource(R.string.agent_sign_in_again)) }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    val enabledLabel = stringResource(R.string.agent_enabled)
                    Text(enabledLabel)
                    Switch(modifier = Modifier.semantics { contentDescription = enabledLabel }, checked = runtime.status == "active", onCheckedChange = store::setEnabled, enabled = store.editable)
                }
                if (runtime.status != "active") Text(stringResource(R.string.agent_enable_before_sign_in))
                TextButton(onClick = { confirmRemoval = true }, enabled = store.editable,
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text(stringResource(R.string.agent_remove_runtime)) }
            } else Text(stringResource(when {
                runtime.deleting -> R.string.agent_removal_in_progress
                runtime.kind == "local" -> R.string.agent_manage_on_host
                runtime.kind == "development" -> R.string.agent_manage_in_development
                else -> R.string.agent_admins_only_manage
            }))
        }
        if (!store.reconciled) Text(stringResource(R.string.agent_unreconciled))
        OutlinedButton(onClick = store::refresh, enabled = !store.busy) { Text(stringResource(R.string.agent_refresh_runtime)) }
    }
    if (confirmRemoval && runtime != null && store.editable) AlertDialog(
        onDismissRequest = { confirmRemoval = false },
        title = { Text(stringResource(R.string.agent_remove_named, runtime.label)) },
        text = { Text(stringResource(if (runtime.kind == "managed") R.string.agent_remove_managed_body
            else R.string.agent_remove_body)) },
        confirmButton = { TextButton(onClick = { confirmRemoval = false; store.remove() },
            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text(stringResource(R.string.agent_remove_runtime)) } },
        dismissButton = { TextButton(onClick = { confirmRemoval = false }) { Text(stringResource(R.string.cancel)) } },
    )
}
