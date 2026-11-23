package ai.nuphos.android.ui.workspace

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ai.nuphos.android.session.WorkspaceSetupStore
import androidx.compose.ui.res.stringResource
import ai.nuphos.android.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkspaceSetupSheet(store: WorkspaceSetupStore, onDismiss: () -> Unit) {
    var name by remember { mutableStateOf("") }
    val state = store.state
    DisposableEffect(store) {
        store.open()
        onDispose { store.close() }
    }
    // Fully expanded, so Create is never left under the navigation bar of a half-open sheet.
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.shell_set_up_workspace), style = MaterialTheme.typography.headlineSmall)
            Text(stringResource(R.string.shell_workspace_setup_body))
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            state.message?.let { Text(it) }
            if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text(stringResource(R.string.shell_workspace_name)) },
                enabled = !state.busy && !state.reviewRequired, singleLine = true, modifier = Modifier.fillMaxWidth())
            Button(onClick = { store.create(name) }, enabled = !state.busy && !state.reviewRequired && name.trim().length in 1..80) {
                Text(stringResource(R.string.shell_create_workspace))
            }
            Text(stringResource(R.string.shell_workspaces_to_join), style = MaterialTheme.typography.titleMedium)
            state.discoveryError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (state.discoveryLoaded && state.discoverable.isEmpty()) Text(stringResource(R.string.shell_no_workspaces_to_join))
            state.discoverable.forEach { team ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(team.name, Modifier.weight(1f).padding(end = 8.dp))
                    OutlinedButton(onClick = { store.join(team.id) }, enabled = !state.busy && !state.reviewRequired) { Text(stringResource(R.string.shell_join_workspace, team.name)) }
                }
            }
            OutlinedButton(onClick = { store.refresh() }, enabled = !state.busy) { Text(stringResource(R.string.shell_refresh_workspaces)) }
            if (state.reviewRequired) {
                Text(stringResource(R.string.shell_workspace_may_have_completed))
                Text(stringResource(R.string.shell_saved_workspaces), style = MaterialTheme.typography.titleMedium)
                state.memberships.forEach { team ->
                    TextButton(onClick = { store.reviewSaved(team.id) }, enabled = !state.busy && state.reconciled) { Text(stringResource(R.string.shell_use_workspace, team.name)) }
                }
                OutlinedButton(onClick = { store.confirmReviewed() }, enabled = !state.busy && state.reconciled) {
                    Text(stringResource(R.string.shell_reviewed_workspaces))
                }
            }
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.shell_close)) }
            Spacer(Modifier.height(16.dp))
        }
    }
}
