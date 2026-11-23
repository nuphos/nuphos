package ai.nuphos.android.ui.chat

import kotlinx.coroutines.CancellationException
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
import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource

@Composable
fun ConversationMenu(session: ChatSession, store: AgentStore, onArchived: () -> Unit, onChooseRuntime: (() -> Unit)? = null) {
    val scope = rememberCoroutineScope()
    var open by remember(session, store.workspaceRevision) { mutableStateOf(false) }
    var desktop by remember(session, store.workspaceRevision) { mutableStateOf(false) }
    var share by remember(session, store.workspaceRevision) { mutableStateOf(false) }
    var rename by remember(session, store.workspaceRevision) { mutableStateOf(false) }
    var archive by remember(session, store.workspaceRevision) { mutableStateOf(false) }
    var title by remember(session, store.workspaceRevision) { mutableStateOf(session.title) }
    var busy by remember(session, store.workspaceRevision) { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val actionFailed = stringResource(R.string.chat_action_failed_retry)
    fun perform(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try { block() } catch (e: Exception) { if (e is CancellationException) throw e; error = e.message ?: actionFailed }
            finally { busy = false }
        }
    }
    // Keep the popup's anchor local to the toolbar button rather than the
    // containing app bar. Logical end positioning also works in RTL.
    Box {
    IconButton(onClick = { open = true }) { Icon(Icons.Outlined.MoreVert, stringResource(R.string.chat_task_actions)) }
    DropdownMenu(expanded = open, onDismissRequest = { open = false },
        modifier = Modifier.widthIn(min = 220.dp, max = 320.dp),
        offset = DpOffset(0.dp, 4.dp), shape = RoundedCornerShape(24.dp)) {
        if (session.shareable) DropdownMenuItem(text = { Text(stringResource(R.string.chat_share)) }, leadingIcon = { Icon(Icons.Outlined.PersonAdd, null) }, enabled = session.loaded && session.loadError == null, onClick = {
            open = false
            share = true
        })
        if (session.canOpenDesktop) DropdownMenuItem(text = { Text(stringResource(R.string.chat_menu_desktop)) }, leadingIcon = { Icon(Icons.Outlined.DesktopWindows, null) }, onClick = { open = false; desktop = true })
        if (session.canWatch) DropdownMenuItem(
            text = { Text(if (session.watching == true) stringResource(R.string.chat_menu_unwatch) else stringResource(R.string.chat_menu_watch)) },
            leadingIcon = { Icon(if (session.watching == true) Icons.Outlined.NotificationsOff else Icons.Outlined.Notifications, null) },
            enabled = !busy && !store.isChangingWatch(session.sessionId),
            onClick = { open = false; perform { store.setWatching(session); error = store.watchError } },
        )
        if (session.canManage) {
            DropdownMenuItem(text = { Text(stringResource(R.string.chat_menu_rename)) }, leadingIcon = { Icon(Icons.Outlined.Edit, null) }, enabled = !busy, onClick = { open = false; title = session.title; rename = true })
            if (onChooseRuntime != null) DropdownMenuItem(text = { Text(stringResource(R.string.chat_switch_runtime)) }, leadingIcon = { Icon(Icons.Outlined.SwapHoriz, null) },
                enabled = !busy && session.canMoveAgent, onClick = { open = false; onChooseRuntime() })
        }
        // Someone else in a Task archives it for themselves alone (#3686).
        if (session.canArchive)
            DropdownMenuItem(text = { Text(if (session.isArchived) stringResource(R.string.chat_menu_restore) else stringResource(R.string.chat_menu_archive)) }, leadingIcon = { Icon(Icons.Outlined.Archive, null) },
                enabled = !busy && (!session.isBot || store.canArchiveBot(session.sessionId)), onClick = { open = false; archive = true })
    }
    }
    if (desktop) ai.nuphos.android.desktop.DesktopScreen(session, store) { desktop = false }
    if (share && session.shareable) {
        val sharing = remember(session) { session.sharingState() }
        ShareSessionSheet(sharing, ConversationActions.shareUrl(session.teamId, session.sessionId)) { share = false }
    }
    if (rename) AlertDialog(onDismissRequest = { if (!busy) rename = false }, title = { Text(stringResource(R.string.chat_rename_task_title)) },
        text = { TextField(value = title, onValueChange = { title = it }, label = { Text(stringResource(R.string.chat_rename_title_label)) }, enabled = !busy, singleLine = true) },
        confirmButton = { TextButton(enabled = !busy && ConversationActions.validTitle(title) != null, onClick = { perform { store.rename(session, title); rename = false } }) { Text(stringResource(R.string.chat_save)) } },
        dismissButton = { TextButton(enabled = !busy, onClick = { rename = false }) { Text(stringResource(R.string.cancel)) } })
    if (archive && session.isBot) ai.nuphos.android.ui.agent.ArchiveBotDialog(store, session.sessionId) { archive = false }
    else if (archive) AlertDialog(onDismissRequest = { if (!busy) archive = false }, title = { Text(if (session.isArchived) stringResource(R.string.chat_restore_task_title) else stringResource(R.string.chat_archive_task_title)) },
        text = { Text(if (session.isArchived) stringResource(R.string.chat_restore_task_body) else stringResource(R.string.chat_archive_task_body)) },
        confirmButton = { TextButton(enabled = !busy, onClick = { perform { val restore = session.isArchived; store.archive(session, !restore); archive = false; if (!restore) onArchived() } }) { Text(if (session.isArchived) stringResource(R.string.chat_menu_restore) else stringResource(R.string.chat_menu_archive)) } },
        dismissButton = { TextButton(enabled = !busy, onClick = { archive = false }) { Text(stringResource(R.string.cancel)) } })
    if (error != null) AlertDialog(onDismissRequest = { error = null }, title = { Text(stringResource(R.string.chat_action_failed_title)) }, text = { Text(error.orEmpty()) }, confirmButton = { TextButton(onClick = { error = null }) { Text(stringResource(R.string.chat_ok)) } })
}
