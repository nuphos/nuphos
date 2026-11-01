package ai.nuphos.android.ui.chat

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import ai.nuphos.android.data.ConversationActions
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.ChatSession
import kotlinx.coroutines.launch

@Composable
fun ConversationMenu(session: ChatSession, store: AgentStore, onArchived: () -> Unit, onChooseRuntime: (() -> Unit)? = null) {
    val scope = rememberCoroutineScope()
    var open by remember(session, store.workspaceRevision) { mutableStateOf(false) }
    var share by remember(session, store.workspaceRevision) { mutableStateOf(false) }
    var rename by remember(session, store.workspaceRevision) { mutableStateOf(false) }
    var archive by remember(session, store.workspaceRevision) { mutableStateOf(false) }
    var title by remember(session, store.workspaceRevision) { mutableStateOf(session.title) }
    var busy by remember(session, store.workspaceRevision) { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(session.teamId) { store.loadFavorites() }
    fun perform(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try { block() } catch (e: Exception) { error = e.message ?: "Action failed. Try again." }
            finally { busy = false }
        }
    }
    // Keep the popup's anchor local to the toolbar button rather than the
    // containing app bar. Logical end positioning also works in RTL.
    Box {
    IconButton(onClick = { open = true }) { Icon(Icons.Outlined.MoreVert, "Agent actions") }
    DropdownMenu(expanded = open, onDismissRequest = { open = false },
        modifier = Modifier.widthIn(min = 220.dp, max = 320.dp),
        offset = DpOffset(0.dp, 4.dp), shape = RoundedCornerShape(24.dp)) {
        DropdownMenuItem(text = { Text("Share") }, leadingIcon = { Icon(Icons.Outlined.PersonAdd, null) }, enabled = session.loaded && session.loadError == null, onClick = {
            open = false
            share = true
        })
        val pinned = store.favorites?.contains(session.sessionId) == true
        DropdownMenuItem(text = { Text(if (pinned) "Unpin" else "Pin") }, leadingIcon = { Icon(Icons.Outlined.PushPin, null) }, enabled = !busy && store.favorites != null && session.loaded && session.loadError == null, onClick = {
            open = false; perform { store.pin(session, !pinned) }
        })
        if (store.favorites == null) DropdownMenuItem(text = { Text("Retry favorites") }, onClick = { perform { store.loadFavorites(); error = store.favoritesError } })
        if (session.canWatch) DropdownMenuItem(
            text = { Text(if (session.watching == true) "Unwatch" else "Watch") },
            leadingIcon = { Icon(if (session.watching == true) Icons.Outlined.NotificationsOff else Icons.Outlined.Notifications, null) },
            enabled = !busy && store.watchingSessionId == null,
            onClick = { open = false; perform { store.setWatching(session); error = store.watchError } },
        )
        if (session.canManage) {
            DropdownMenuItem(text = { Text("Rename") }, leadingIcon = { Icon(Icons.Outlined.Edit, null) }, enabled = !busy, onClick = { open = false; title = session.title; rename = true })
            if (onChooseRuntime != null) DropdownMenuItem(text = { Text("Switch runtime") }, leadingIcon = { Icon(Icons.Outlined.SwapHoriz, null) },
                enabled = !busy && session.canMoveAgent, onClick = { open = false; onChooseRuntime() })
            DropdownMenuItem(text = { Text(if (session.isArchived) "Restore" else "Archive") }, leadingIcon = { Icon(Icons.Outlined.Archive, null) }, enabled = !busy, onClick = { open = false; archive = true })
        }
    }
    }
    if (share) {
        val sharing = remember(session) { session.sharingState() }
        ShareSessionSheet(sharing, ConversationActions.shareUrl(session.teamId, session.sessionId)) { share = false }
    }
    if (rename) AlertDialog(onDismissRequest = { if (!busy) rename = false }, title = { Text("Rename agent") },
        text = { TextField(value = title, onValueChange = { title = it }, label = { Text("Title") }, enabled = !busy, singleLine = true) },
        confirmButton = { TextButton(enabled = !busy && ConversationActions.validTitle(title) != null, onClick = { perform { store.rename(session, title); rename = false } }) { Text("Save") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { rename = false }) { Text("Cancel") } })
    if (archive) AlertDialog(onDismissRequest = { if (!busy) archive = false }, title = { Text(if (session.isArchived) "Restore agent?" else "Archive agent?") },
        text = { Text(if (session.isArchived) "Move this agent to Active." else "You can restore this agent from Archived.") },
        confirmButton = { TextButton(enabled = !busy, onClick = { perform { val restore = session.isArchived; store.archive(session, !restore); archive = false; if (!restore) onArchived() } }) { Text(if (session.isArchived) "Restore" else "Archive") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { archive = false }) { Text("Cancel") } })
    if (error != null) AlertDialog(onDismissRequest = { error = null }, title = { Text("Action failed") }, text = { Text(error.orEmpty()) }, confirmButton = { TextButton(onClick = { error = null }) { Text("OK") } })
}
