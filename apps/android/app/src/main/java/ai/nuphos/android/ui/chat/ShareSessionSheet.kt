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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import ai.nuphos.android.data.*
import ai.nuphos.android.model.TeamMember
import ai.nuphos.android.session.SharingState
import kotlinx.coroutines.launch

private const val LOCAL_WARNING = "This agent runs on your computer’s local runtime. Anyone you share it with can run commands on your computer."

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareSessionSheet(state: SharingState, url: String?, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var search by remember { mutableStateOf("") }
    var inviteRole by remember { mutableStateOf(ShareRole.Reply) }
    var confirm by remember { mutableStateOf<Pair<TeamMember, ShareRole>?>(null) }
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(state) { state.load() }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        LazyColumn(modifier = Modifier.fillMaxWidth().imePadding(), contentPadding = PaddingValues(horizontal = 24.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Share agent", style = MaterialTheme.typography.headlineSmall)
                    TextButton(onClick = onDismiss) { Text("Done") }
                }
            }
            if (url != null) item {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = {
                        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Agent link", url))
                        copied = true
                    }) { Text(if (copied) "Copied" else "Copy link") }
                    OutlinedButton(onClick = {
                        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, url) }, "Share agent"))
                    }) { Text("Share link") }
                }
            }
            val access = state.access
            if (state.loadError != null) item { Text(state.loadError.orEmpty(), color = MaterialTheme.colorScheme.error) }
            if (access == null && state.loadError == null) item { CircularProgressIndicator(Modifier.size(24.dp)) }
            if (state.loadError != null || state.membersError != null) item {
                TextButton(enabled = !state.loading && state.pending == null, onClick = { scope.launch { state.load() } }) { Text("Retry sharing") }
            }
            if (access != null) {
                item {
                    Text("General access", style = MaterialTheme.typography.titleMedium)
                    if (state.canManage) ChoiceMenu("Team access", access.generalAccess.title, state.editable, GeneralAccess.entries,
                        { it.title }, onSelect = { scope.launch { state.general(it) } })
                    else Text(access.generalAccess.title)
                    if (state.pending == "access") CircularProgressIndicator(Modifier.size(20.dp))
                    if (state.localRuntime && state.canManage) Text(LOCAL_WARNING, color = MaterialTheme.colorScheme.tertiary, style = MaterialTheme.typography.bodySmall)
                }
                item { Text("In this agent", style = MaterialTheme.typography.titleMedium) }
                items(access.participants, key = { "participant:${it.id}" }) { person ->
                    Column(Modifier.fillMaxWidth()) {
                        Text(person.displayName, color = if (person.deactivated) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                        if (person.deactivated) Text("Deactivated", style = MaterialTheme.typography.labelSmall)
                        if (person.isOwner) Text("Owner", style = MaterialTheme.typography.labelMedium)
                        else if (!state.canManage) Text(person.effectiveRole(access.generalAccess).title)
                        else ChoiceMenu("Role for ${person.displayName}", person.effectiveRole(access.generalAccess).title,
                            state.editable, ShareRole.entries, { it.title }, allowed = { it.rank >= access.generalAccess.floor },
                            onSelect = { scope.launch { state.role(person, it) } },
                            extra = { close -> DropdownMenuItem(text = { Text("Remove") }, onClick = { close(); scope.launch { state.remove(person) } }) })
                        if (state.pending == person.id) CircularProgressIndicator(Modifier.size(20.dp))
                    }
                }
                item {
                    Text("General access applies to everyone on the team. Removing a person only removes their individual grant.", style = MaterialTheme.typography.bodySmall)
                    if (!state.canManage) Text("Only the owner can change who has access.", style = MaterialTheme.typography.bodySmall)
                }
                if (state.canManage) {
                    state.added?.let { added -> item {
                        Text("Added ${added.displayName}")
                        TextButton(enabled = state.editable, onClick = { scope.launch { state.undo() } }) { Text("Undo invite") }
                    } }
                    item {
                        HorizontalDivider()
                        Text("Add people", style = MaterialTheme.typography.titleMedium)
                        ChoiceMenu("Invite as", inviteRole.title, state.editable, ShareRole.entries, { it.title }, onSelect = { inviteRole = it })
                        OutlinedTextField(value = search, onValueChange = { search = it }, label = { Text("Search teammates") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        state.membersError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                        if (state.members == null && state.membersError == null) CircularProgressIndicator(Modifier.size(24.dp))
                    }
                    val query = search.trim()
                    val invitable = state.members.orEmpty().filter { member -> !member.isRemoved && access.participants.none { it.id == member.id } &&
                        (query.isBlank() || member.displayName.contains(query, true) || member.email.contains(query, true)) }
                    if (state.members != null && invitable.isEmpty()) item { Text("No teammates to add") }
                    items(invitable, key = { "member:${it.id}" }) { member ->
                        OutlinedButton(enabled = state.canInvite, onClick = {
                            val role = inviteRole
                            if (state.localRuntime && role != ShareRole.View) confirm = member to role
                            else scope.launch { state.invite(member, role) }
                        }, modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.weight(1f)) { Text(member.displayName); Text(member.email, style = MaterialTheme.typography.bodySmall) }
                            Text(if (state.pending == member.id) "Adding…" else "Add")
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(16.dp)) }
        }
    }
    confirm?.let { (member, role) ->
        AlertDialog(onDismissRequest = { confirm = null }, title = { Text("Let ${member.displayName} use your computer?") },
            text = { Text("This agent runs on your computer’s local runtime. They will be able to run commands on your computer.") },
            confirmButton = { TextButton(enabled = state.canInvite, onClick = { confirm = null; scope.launch { state.invite(member, role) } }) { Text("Invite") } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancel") } })
    }
    state.error?.let { message -> AlertDialog(onDismissRequest = state::clearError, title = { Text("Couldn't update sharing") }, text = { Text(message) },
        confirmButton = { TextButton(onClick = state::clearError) { Text("OK") } }) }
}

@Composable
private fun <T> ChoiceMenu(label: String, value: String, enabled: Boolean, options: List<T>, title: (T) -> String,
    allowed: (T) -> Boolean = { true }, onSelect: (T) -> Unit,
    extra: (@Composable (() -> Unit) -> Unit)? = null) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(enabled = enabled, onClick = { open = true }) { Text("$label: $value") }
        DropdownMenu(expanded = open && enabled, onDismissRequest = { open = false }) {
            options.forEach { option -> DropdownMenuItem(text = { Text(title(option)) }, enabled = allowed(option), onClick = { open = false; onSelect(option) }) }
            extra?.invoke { open = false }
        }
    }
}
