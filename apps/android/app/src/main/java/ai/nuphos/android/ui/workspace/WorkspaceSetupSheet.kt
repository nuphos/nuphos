package ai.nuphos.android.ui.workspace

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ai.nuphos.android.session.WorkspaceSetupStore

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkspaceSetupSheet(store: WorkspaceSetupStore, onDismiss: () -> Unit) {
    var name by remember { mutableStateOf("") }
    val state = store.state
    DisposableEffect(store) {
        store.open()
        onDispose { store.close() }
    }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Set up a workspace", style = MaterialTheme.typography.headlineSmall)
            Text("Create a workspace, join an available workspace, or refresh after accepting an invitation from its link.")
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            state.message?.let { Text(it) }
            if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Workspace name") },
                enabled = !state.busy && !state.reviewRequired, singleLine = true, modifier = Modifier.fillMaxWidth())
            Button(onClick = { store.create(name) }, enabled = !state.busy && !state.reviewRequired && name.trim().length in 1..80) {
                Text("Create workspace")
            }
            Text("Workspaces you can join", style = MaterialTheme.typography.titleMedium)
            state.discoveryError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (state.discoveryLoaded && state.discoverable.isEmpty()) Text("No workspaces are available to join for this account.")
            state.discoverable.forEach { team ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(team.name, Modifier.weight(1f).padding(end = 8.dp))
                    OutlinedButton(onClick = { store.join(team.id) }, enabled = !state.busy && !state.reviewRequired) { Text("Join ${team.name}") }
                }
            }
            OutlinedButton(onClick = { store.refresh() }, enabled = !state.busy) { Text("Refresh workspaces") }
            if (state.reviewRequired) {
                Text("The request may have completed. Closing this sheet does not undo a saved workspace.")
                Text("Saved workspaces", style = MaterialTheme.typography.titleMedium)
                state.memberships.forEach { team ->
                    TextButton(onClick = { store.reviewSaved(team.id) }, enabled = !state.busy && state.reconciled) { Text("Use ${team.name}") }
                }
                OutlinedButton(onClick = { store.confirmReviewed() }, enabled = !state.busy && state.reconciled) {
                    Text("I reviewed saved workspaces")
                }
            }
            TextButton(onClick = onDismiss) { Text("Close") }
            Spacer(Modifier.height(16.dp))
        }
    }
}
