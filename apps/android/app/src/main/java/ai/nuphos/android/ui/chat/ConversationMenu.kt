package ai.nuphos.android.ui.chat

import android.content.Intent
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import ai.nuphos.android.data.ConversationActions
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.ChatSession
import kotlinx.coroutines.launch

@Composable
fun ConversationMenu(session: ChatSession, store: AgentStore, onArchived: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var rename by remember { mutableStateOf(false) }
    var archive by remember { mutableStateOf(false) }
    var title by remember(session.sessionId) { mutableStateOf(session.title) }
    var busy by remember { mutableStateOf(false) }
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
    IconButton(onClick = { open = true }) { Icon(Icons.Outlined.MoreVert, "Chat actions") }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        DropdownMenuItem(text = { Text("Share") }, enabled = session.loaded && session.loadError == null, onClick = {
            open = false
            ConversationActions.shareUrl(session.teamId, session.sessionId)?.let { url ->
                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"; putExtra(Intent.EXTRA_TEXT, url)
                }, "Share chat"))
            }
        })
        val pinned = store.favorites?.contains(session.sessionId) == true
        DropdownMenuItem(text = { Text(if (pinned) "Unpin" else "Pin") }, enabled = !busy && store.favorites != null && session.loaded && session.loadError == null, onClick = {
            open = false; perform { store.pin(session, !pinned) }
        })
        if (store.favorites == null) DropdownMenuItem(text = { Text("Retry favorites") }, onClick = { perform { store.loadFavorites(); error = store.favoritesError } })
        if (session.canManage) {
            DropdownMenuItem(text = { Text("Rename") }, enabled = !busy, onClick = { open = false; title = session.title; rename = true })
            DropdownMenuItem(text = { Text(if (session.isArchived) "Restore" else "Archive") }, enabled = !busy, onClick = { open = false; archive = true })
        }
    }
    if (rename) AlertDialog(onDismissRequest = { if (!busy) rename = false }, title = { Text("Rename chat") },
        text = { TextField(value = title, onValueChange = { title = it }, label = { Text("Title") }, enabled = !busy, singleLine = true) },
        confirmButton = { TextButton(enabled = !busy && ConversationActions.validTitle(title) != null, onClick = { perform { store.rename(session, title); rename = false } }) { Text("Save") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { rename = false }) { Text("Cancel") } })
    if (archive) AlertDialog(onDismissRequest = { if (!busy) archive = false }, title = { Text(if (session.isArchived) "Restore chat?" else "Archive chat?") },
        text = { Text(if (session.isArchived) "Move this chat to Active." else "You can restore this chat from Archived.") },
        confirmButton = { TextButton(enabled = !busy, onClick = { perform { val restore = session.isArchived; store.archive(session, !restore); archive = false; if (!restore) onArchived() } }) { Text(if (session.isArchived) "Restore" else "Archive") } },
        dismissButton = { TextButton(enabled = !busy, onClick = { archive = false }) { Text("Cancel") } })
    if (error != null) AlertDialog(onDismissRequest = { error = null }, title = { Text("Action failed") }, text = { Text(error.orEmpty()) }, confirmButton = { TextButton(onClick = { error = null }) { Text("OK") } })
}
