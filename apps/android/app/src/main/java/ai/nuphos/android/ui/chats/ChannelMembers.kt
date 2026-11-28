package ai.nuphos.android.ui.chats

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PersonAddAlt
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.nuphos.android.R
import ai.nuphos.android.data.SessionAccess
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.BotPresence
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.model.TeamMember
import ai.nuphos.android.session.ChannelMembers
import ai.nuphos.android.ui.chat.ComputerUseDialog
import ai.nuphos.android.ui.components.AgentAvatar
import ai.nuphos.android.ui.components.NuphosAvatar
import kotlinx.coroutines.launch

private enum class MembersPage { Members, AddBot, AddPeople }

/**
 * A group chat's Members (#5313): its Bots, each with whether it can reply now (#3308), its people,
 * adding either, and leaving. [yourBots] are the viewer's Bots that could join it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ChannelMembersSheet(members: ChannelMembers, title: String, agents: List<ChannelAgent>, viewerId: String?,
    yourBots: List<AgentConversation> = emptyList(), teamName: String? = null, canSend: Boolean = true,
    onLeft: () -> Unit = {}, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var page by remember { mutableStateOf(MembersPage.Members) }
    var leaving by remember { mutableStateOf(false) }
    LaunchedEffect(members) { members.load() }
    LaunchedEffect(members.left) { if (members.left) onLeft() }
    // Each failure once, with Retry; the retry outlives the snackbar it came from.
    members.failure?.let { failure ->
        val message = stringResource(failure.message)
        val retry = stringResource(R.string.chats_members_retry)
        LaunchedEffect(failure) {
            if (snackbar.showSnackbar(message, retry, duration = SnackbarDuration.Long) == SnackbarResult.ActionPerformed)
                scope.launch { failure.retry() }
            else members.dismissFailure()
        }
    }
    // An add that went through, or now waits on the computer question, goes back to the list.
    fun add(action: suspend () -> Unit) {
        scope.launch {
            action()
            if (members.failure == null && members.sharing.needsComputer == null) page = MembersPage.Members
        }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Box(Modifier.fillMaxWidth().heightIn(min = 640.dp)) {
            LazyColumn(Modifier.fillMaxWidth().testTag("members-sheet"), contentPadding = PaddingValues(bottom = 24.dp)) {
                when (page) {
                    MembersPage.Members -> membersPage(members, agents, viewerId, canSend,
                        onAddBot = { page = MembersPage.AddBot }, onAddPeople = { page = MembersPage.AddPeople },
                        onRemoveBot = { scope.launch { members.removeBot(it.sessionId) } },
                        onRemovePerson = { scope.launch { members.removePerson(it) } },
                        onLeave = { leaving = true })
                    MembersPage.AddBot -> {
                        item { PageHeader(stringResource(R.string.chats_members_add_bot)) { page = MembersPage.Members } }
                        item { SectionLabel(stringResource(R.string.chats_members_your_bots)) }
                        val joinable = yourBots.filter { bot -> agents.none { it.sessionId == bot.sessionId } }
                        if (joinable.isEmpty()) item { Note(stringResource(R.string.chats_members_no_bots)) }
                        items(joinable, key = { "bot:${it.sessionId}" }) { bot ->
                            MemberRow({ AgentAvatar(bot.sessionId, bot.agentRuntime, 32.dp) }, bot.title, Modifier.testTag("add-bot-row")) {
                                AddButton(bot.title, !members.busy) { add { members.addBot(bot.sessionId) } }
                            }
                        }
                        item { Note(stringResource(R.string.chats_members_add_bot_note), Modifier.padding(top = 8.dp)) }
                    }
                    MembersPage.AddPeople -> addPeoplePage(members, teamName, onBack = { page = MembersPage.Members },
                        onAdd = { member -> add { members.addPerson(member) } })
                }
            }
            SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = 96.dp))
        }
    }
    ComputerUseDialog(members.sharing) { add { members.confirmComputer() } }
    if (leaving) LeaveDialog(members, title, onDismiss = { leaving = false }) {
        leaving = false
        scope.launch { members.leave() }
    }
}

private fun LazyListScope.membersPage(members: ChannelMembers, agents: List<ChannelAgent>, viewerId: String?, canSend: Boolean,
    onAddBot: () -> Unit, onAddPeople: () -> Unit, onRemoveBot: (ChannelAgent) -> Unit,
    onRemovePerson: (SessionAccess.Participant) -> Unit, onLeave: () -> Unit) {
    item { Text(stringResource(R.string.chats_members), Modifier.padding(start = 20.dp, top = 4.dp, bottom = 8.dp), style = MaterialTheme.typography.titleLarge) }
    item { SectionLabel(stringResource(R.string.chats_bots)) }
    items(agents, key = { "agent:${it.sessionId}" }) { agent ->
        MemberRow({ AgentAvatar(agent.sessionId, agent.provider, 32.dp) }, agent.title, Modifier.testTag("member-row")) {
            agent.presence?.let { PresenceTag(it) }
            // The chat's owner may take out any Bot; anyone else, their own.
            if (members.isOwner || (viewerId != null && agent.ownerId == viewerId)) MoreMenu(agent.title, !members.busy) { onRemoveBot(agent) }
        }
    }
    if (canSend) item { ActionRow(Icons.Outlined.SmartToy, stringResource(R.string.chats_members_add_bot), onClick = onAddBot) }
    item { SectionLabel(stringResource(R.string.chats_members_people), Modifier.padding(top = 8.dp)) }
    items(members.people, key = { "person:${it.id}" }) { person ->
        val you = person.id == viewerId
        val name = if (you) stringResource(R.string.chats_members_you, person.displayName) else person.displayName
        MemberRow({ NuphosAvatar(NuphosUser(person.id, person.email, person.name, avatarURL = person.avatarURL.orEmpty()), 32.dp) }, name,
            Modifier.testTag("person-row")) {
            if (person.isOwner) Text(stringResource(R.string.chat_share_owner), Modifier.padding(end = 12.dp),
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            else if (members.isOwner) MoreMenu(person.displayName, members.sharing.editable && !members.busy) { onRemovePerson(person) }
        }
    }
    if (members.sharing.access != null) item {
        if (members.isOwner) ActionRow(Icons.Outlined.PersonAddAlt, stringResource(R.string.chat_share_add_people), onClick = onAddPeople)
        else Note(stringResource(R.string.chats_members_owner_only), Modifier.padding(start = 48.dp))
    }
    item {
        HorizontalDivider(Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.outlineVariant)
        ActionRow(Icons.AutoMirrored.Outlined.Logout, stringResource(R.string.chats_members_leave), MaterialTheme.colorScheme.error,
            enabled = members.sharing.access != null && !members.busy, onClick = onLeave)
    }
}

private fun LazyListScope.addPeoplePage(members: ChannelMembers, teamName: String?, onBack: () -> Unit, onAdd: (TeamMember) -> Unit) {
    item { PageHeader(stringResource(R.string.chat_share_add_people), onBack) }
    item(key = "search") {
        var search by remember { mutableStateOf("") }
        val sharing = members.sharing
        Column {
            OutlinedTextField(search, { search = it }, Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
                placeholder = { Text(stringResource(R.string.chat_share_search_teammates)) },
                leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true)
            teamName?.let { SectionLabel(it) }
            sharing.membersError?.let { Note(it) }
            if (sharing.members == null && sharing.membersError == null) CircularProgressIndicator(Modifier.padding(20.dp).size(24.dp))
            val invitable = sharing.invitable(search)
            if (sharing.members != null && invitable.isEmpty()) Note(stringResource(R.string.chat_share_no_teammates))
            invitable.forEach { member ->
                MemberRow({ NuphosAvatar(member.asUser(), 32.dp) }, member.displayName, Modifier.testTag("add-person-row"), member.email) {
                    AddButton(member.displayName, sharing.canInvite && !members.busy) { onAdd(member) }
                }
            }
        }
    }
}

@Composable
private fun LeaveDialog(members: ChannelMembers, title: String, onDismiss: () -> Unit, onLeave: () -> Unit) {
    val heir = members.heir
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.chats_members_leave_title, title)) },
        text = { Text(when {
            members.last -> stringResource(R.string.chats_members_leave_last)
            heir != null -> stringResource(R.string.chats_members_leave_owner, heir.displayName)
            else -> stringResource(R.string.chats_members_leave_member)
        }) },
        confirmButton = { TextButton(onClick = onLeave) { Text(stringResource(R.string.chats_members_leave_confirm), color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

@Composable
private fun PageHeader(title: String, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 20.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.chats_back)) }
        Text(title, style = MaterialTheme.typography.titleLarge)
    }
}

@Composable
private fun SectionLabel(text: String, modifier: Modifier = Modifier) =
    Text(text, modifier.padding(horizontal = 20.dp, vertical = 8.dp), style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant)

@Composable
private fun Note(text: String, modifier: Modifier = Modifier) =
    Text(text, modifier.padding(horizontal = 20.dp, vertical = 8.dp), style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)

@Composable
private fun MemberRow(avatar: @Composable () -> Unit, name: String, modifier: Modifier = Modifier, detail: String? = null,
    trailing: @Composable RowScope.() -> Unit) {
    Row(modifier.fillMaxWidth().heightIn(min = 56.dp).padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        avatar()
        Column(Modifier.weight(1f)) {
            Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
            detail?.let { Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        Row(verticalAlignment = Alignment.CenterVertically, content = trailing)
    }
}

@Composable
private fun ActionRow(icon: ImageVector, text: String, color: Color = MaterialTheme.colorScheme.onSurface, enabled: Boolean = true, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).heightIn(min = 56.dp).padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Box(Modifier.size(32.dp), contentAlignment = Alignment.Center) { Icon(icon, null, tint = color) }
        Text(text, color = color, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun AddButton(name: String, enabled: Boolean, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled) { Icon(Icons.Outlined.AddCircleOutline, stringResource(R.string.chats_members_add, name)) }
}

@Composable
private fun MoreMenu(name: String, enabled: Boolean, onRemove: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }, enabled = enabled) { Icon(Icons.Outlined.MoreVert, stringResource(R.string.chats_members_more, name)) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.chat_share_remove)) }, onClick = { open = false; onRemove() })
        }
    }
}

@Composable
private fun PresenceTag(presence: BotPresence) {
    val (tone, word) = presence.tag
    val color = when (tone) {
        BotPresence.Tone.Ready -> Color(0xFF2E7D32)
        BotPresence.Tone.Waiting -> Color(0xFFAF601A)
        BotPresence.Tone.Down -> MaterialTheme.colorScheme.error
    }
    Row(Modifier.padding(end = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(6.dp).background(color, CircleShape))
        Text(word, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
