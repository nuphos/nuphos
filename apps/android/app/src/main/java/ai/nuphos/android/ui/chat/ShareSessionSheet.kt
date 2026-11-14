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
import androidx.compose.ui.unit.dp
import ai.nuphos.android.data.*
import ai.nuphos.android.model.TeamMember
import ai.nuphos.android.session.SharingState
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareSessionSheet(state: SharingState, url: String?, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var search by remember { mutableStateOf("") }
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(state) { state.load() }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        LazyColumn(modifier = Modifier.fillMaxWidth().imePadding(), contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Share", style = MaterialTheme.typography.titleLarge)
                    TextButton(onClick = onDismiss) { Text("Done") }
                }
            }
            if (url != null) item {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = {
                        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Task link", url))
                        copied = true
                    }) { Text(if (copied) "Copied" else "Copy link") }
                    OutlinedButton(onClick = {
                        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, url) }, "Share task"))
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
                    // Only a chat lets the whole team reply; elsewhere replying follows the computer.
                    if (state.canManage) ChoiceMenu("Team access", access.generalAccess.title, state.editable,
                        GeneralAccess.entries.filter { it != GeneralAccess.Reply || access.generalAccess == GeneralAccess.Reply },
                        { it.title }, onSelect = { scope.launch { state.general(it) } })
                    else Text(access.generalAccess.title)
                    if (state.pending == "access") CircularProgressIndicator(Modifier.size(20.dp))
                }
                item { Text("In this agent", style = MaterialTheme.typography.titleMedium) }
                items(access.participants, key = { "participant:${it.id}" }) { person ->
                    Column(Modifier.fillMaxWidth()) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.size(28.dp)) {
                            Box(contentAlignment = Alignment.Center) { Text(person.displayName.take(1).uppercase(), style = MaterialTheme.typography.labelMedium) }
                        }
                        Column(Modifier.weight(1f)) {
                        Text(person.displayName, color = if (person.deactivated) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                        if (person.deactivated) Text("Deactivated", style = MaterialTheme.typography.labelSmall)
                        }
                        if (person.isOwner) Text("Owner", style = MaterialTheme.typography.labelMedium)
                        else if (!state.canManage) Text(person.roleTitle)
                        // "Can view": they cannot use the session's computer yet.
                        else ChoiceMenu("Role for ${person.displayName}", person.roleTitle, state.editable, emptyList<Unit>(), { "" },
                            onSelect = {}, showLabel = false,
                            extra = { close ->
                                if (!person.canReply) DropdownMenuItem(text = { Text("Let them reply") }, onClick = { close(); scope.launch { state.letReply(person) } })
                                DropdownMenuItem(text = { Text("Remove") }, onClick = { close(); scope.launch { state.remove(person) } })
                            })
                        }
                        HorizontalDivider(Modifier.padding(start = 38.dp), color = MaterialTheme.colorScheme.outlineVariant)
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
                        OutlinedTextField(value = search, onValueChange = { search = it }, label = { Text("Search teammates") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        state.membersError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                        if (state.members == null && state.membersError == null) CircularProgressIndicator(Modifier.size(24.dp))
                    }
                    val query = search.trim()
                    val invitable = state.members.orEmpty().filter { member -> !member.isRemoved && access.participants.none { it.id == member.id } &&
                        (query.isBlank() || member.displayName.contains(query, true) || member.email.contains(query, true)) }
                    if (state.members != null && invitable.isEmpty()) item { Text("No teammates to add") }
                    items(invitable, key = { "member:${it.id}" }) { member ->
                        OutlinedButton(enabled = state.canInvite, onClick = { scope.launch { state.invite(member) } }, modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.weight(1f)) { Text(member.displayName); Text(member.email, style = MaterialTheme.typography.bodySmall) }
                            Text(if (state.pending == member.id) "Adding…" else "Add")
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(16.dp)) }
        }
    }
    state.needsComputer?.let {
        AlertDialog(onDismissRequest = state::cancelComputer, title = { Text("Also give use of this computer?") },
            text = { Text("Adding this person to the task also gives them use of this computer. Continue?") },
            confirmButton = { TextButton(enabled = state.canInvite, onClick = { scope.launch { state.confirmComputer() } }) { Text("Continue") } },
            dismissButton = { TextButton(onClick = state::cancelComputer) { Text("Cancel") } })
    }
    state.error?.let { message -> AlertDialog(onDismissRequest = state::clearError, title = { Text("Couldn't update sharing") }, text = { Text(message) },
        confirmButton = { TextButton(onClick = state::clearError) { Text("OK") } }) }
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
