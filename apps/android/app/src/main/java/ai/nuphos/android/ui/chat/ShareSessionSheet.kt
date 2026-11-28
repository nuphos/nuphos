package ai.nuphos.android.ui.chat

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.unit.dp
import ai.nuphos.android.data.*
import ai.nuphos.android.model.TeamMember
import ai.nuphos.android.session.SharingState
import kotlinx.coroutines.launch
import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareSessionSheet(state: SharingState, url: String?, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val resources = LocalResources.current
    val scope = rememberCoroutineScope()
    val accessTitles = GeneralAccess.entries.associateWith { stringResource(it.title) }
    var search by remember { mutableStateOf("") }
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(state) { state.load() }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        LazyColumn(modifier = Modifier.fillMaxWidth().imePadding(), contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(stringResource(R.string.chat_share), style = MaterialTheme.typography.titleLarge)
                    TextButton(onClick = onDismiss) { Text(stringResource(R.string.done)) }
                }
            }
            if (url != null) item {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = {
                        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(resources.getString(R.string.chat_share_clip_label), url))
                        copied = true
                    }) { Text(if (copied) stringResource(R.string.chat_share_copied) else stringResource(R.string.chat_share_copy_link)) }
                    OutlinedButton(onClick = {
                        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, url) }, resources.getString(R.string.chat_share_task)))
                    }) { Text(stringResource(R.string.chat_share_link)) }
                }
            }
            val access = state.access
            if (state.loadError != null) item { Text(state.loadError.orEmpty(), color = MaterialTheme.colorScheme.error) }
            if (access == null && state.loadError == null) item { CircularProgressIndicator(Modifier.size(24.dp)) }
            if (state.loadError != null || state.membersError != null) item {
                TextButton(enabled = !state.loading && state.pending == null, onClick = { scope.launch { state.load() } }) { Text(stringResource(R.string.chat_share_retry)) }
            }
            if (access != null) {
                item {
                    Text(stringResource(R.string.chat_share_general_access), style = MaterialTheme.typography.titleMedium)
                    // Only a chat lets the whole team reply; elsewhere replying follows the computer.
                    if (state.canManage) ChoiceMenu(stringResource(R.string.chat_share_team_access), accessTitles.getValue(access.generalAccess), state.editable,
                        GeneralAccess.entries.filter { it != GeneralAccess.Reply || access.generalAccess == GeneralAccess.Reply },
                        { accessTitles.getValue(it) }, onSelect = { scope.launch { state.general(it) } })
                    else Text(accessTitles.getValue(access.generalAccess))
                    if (state.pending == "access") CircularProgressIndicator(Modifier.size(20.dp))
                }
                item { Text(stringResource(R.string.chat_share_in_this_agent), style = MaterialTheme.typography.titleMedium) }
                items(access.participants, key = { "participant:${it.id}" }) { person ->
                    Column(Modifier.fillMaxWidth()) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.size(28.dp)) {
                            Box(contentAlignment = Alignment.Center) { Text(person.displayName.take(1).uppercase(), style = MaterialTheme.typography.labelMedium) }
                        }
                        Column(Modifier.weight(1f)) {
                        Text(person.displayName, color = if (person.deactivated) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                        if (person.deactivated) Text(stringResource(R.string.chat_share_deactivated), style = MaterialTheme.typography.labelSmall)
                        }
                        if (person.isOwner) Text(stringResource(R.string.chat_share_owner), style = MaterialTheme.typography.labelMedium)
                        else if (!state.canManage) Text(stringResource(person.roleTitle))
                        // "Can view": they cannot use the session's computer yet.
                        else ChoiceMenu(stringResource(R.string.chat_share_role_for, person.displayName), stringResource(person.roleTitle), state.editable, emptyList<Unit>(), { "" },
                            onSelect = {}, showLabel = false,
                            extra = { close ->
                                if (!person.canReply) DropdownMenuItem(text = { Text(stringResource(R.string.chat_share_let_reply)) }, onClick = { close(); scope.launch { state.letReply(person) } })
                                DropdownMenuItem(text = { Text(stringResource(R.string.chat_share_remove)) }, onClick = { close(); scope.launch { state.remove(person) } })
                            })
                        }
                        HorizontalDivider(Modifier.padding(start = 38.dp), color = MaterialTheme.colorScheme.outlineVariant)
                        if (state.pending == person.id) CircularProgressIndicator(Modifier.size(20.dp))
                    }
                }
                item {
                    Text(stringResource(R.string.chat_share_general_access_note), style = MaterialTheme.typography.bodySmall)
                    if (!state.canManage) Text(stringResource(R.string.chat_share_owner_only), style = MaterialTheme.typography.bodySmall)
                }
                if (state.canManage) {
                    state.added?.let { added -> item {
                        Text(stringResource(R.string.chat_share_added, added.displayName))
                        TextButton(enabled = state.editable, onClick = { scope.launch { state.undo() } }) { Text(stringResource(R.string.chat_share_undo_invite)) }
                    } }
                    item {
                        HorizontalDivider()
                        Text(stringResource(R.string.chat_share_add_people), style = MaterialTheme.typography.titleMedium)
                        OutlinedTextField(value = search, onValueChange = { search = it }, label = { Text(stringResource(R.string.chat_share_search_teammates)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        state.membersError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                        if (state.members == null && state.membersError == null) CircularProgressIndicator(Modifier.size(24.dp))
                    }
                    val invitable = state.invitable(search)
                    if (state.members != null && invitable.isEmpty()) item { Text(stringResource(R.string.chat_share_no_teammates)) }
                    items(invitable, key = { "member:${it.id}" }) { member ->
                        OutlinedButton(enabled = state.canInvite, onClick = { scope.launch { state.invite(member) } }, modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.weight(1f)) { Text(member.displayName); Text(member.email, style = MaterialTheme.typography.bodySmall) }
                            Text(if (state.pending == member.id) stringResource(R.string.chat_share_adding) else stringResource(R.string.chat_share_add))
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(16.dp)) }
        }
    }
    ComputerUseDialog(state) { scope.launch { state.confirmComputer() } }
    state.error?.let { message -> AlertDialog(onDismissRequest = state::clearError, title = { Text(stringResource(R.string.chat_share_update_failed)) }, text = { Text(message) },
        confirmButton = { TextButton(onClick = state::clearError) { Text(stringResource(R.string.chat_ok)) } }) }
}

/** "Also give use of this computer?": an invite the server refused until it does. A group chat's Members asks it too. */
@Composable
internal fun ComputerUseDialog(state: SharingState, onConfirm: () -> Unit) {
    if (state.needsComputer == null) return
    AlertDialog(onDismissRequest = state::cancelComputer, title = { Text(stringResource(R.string.chat_share_computer_title)) },
        text = { Text(stringResource(R.string.chat_share_computer_body)) },
        confirmButton = { TextButton(enabled = state.canInvite, onClick = onConfirm) { Text(stringResource(R.string.chat_continue)) } },
        dismissButton = { TextButton(onClick = state::cancelComputer) { Text(stringResource(R.string.cancel)) } })
}

@Composable
private fun <T> ChoiceMenu(label: String, value: String, enabled: Boolean, options: List<T>, title: (T) -> String,
    allowed: (T) -> Boolean = { true }, onSelect: (T) -> Unit,
    showLabel: Boolean = true,
    extra: (@Composable (() -> Unit) -> Unit)? = null) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(enabled = enabled, onClick = { open = true }, modifier = Modifier.semantics { contentDescription = "$label: $value" }) { Text(if (showLabel) "$label: $value" else value) }
        DropdownMenu(expanded = open && enabled, onDismissRequest = { open = false }) {
            options.forEach { option -> DropdownMenuItem(text = { Text(title(option)) }, enabled = allowed(option), onClick = { open = false; onSelect(option) }) }
            extra?.invoke { open = false }
        }
    }
}
