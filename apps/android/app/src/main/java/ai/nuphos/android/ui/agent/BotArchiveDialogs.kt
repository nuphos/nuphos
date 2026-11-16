package ai.nuphos.android.ui.agent

import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.unit.dp
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.BotArchive

/** Asks before Archive Bot, then waits for it, since the Bot and its chats are several requests. */
@Composable
fun ArchiveBotDialog(store: AgentStore, botId: String, onDismiss: () -> Unit) {
    val bot = store.botRow(botId)
    var started by remember(botId) { mutableStateOf(false) }
    val busy = store.archivingBotId == botId
    // Done, or reported by the dialog below.
    LaunchedEffect(started, busy) { if (started && !busy) onDismiss() }
    if (bot == null || (!started && !store.canArchiveBot(botId))) { LaunchedEffect(Unit) { onDismiss() }; return }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(stringResource(R.string.agent_archive_bot_title)) },
        text = { Text(stringResource(R.string.agent_archive_bot_body, bot.displayTitle)) },
        confirmButton = { TextButton(enabled = !busy, onClick = { started = true; store.archiveBot(botId) }) {
            Text(stringResource(if (busy) R.string.agent_archiving else R.string.agent_archive))
        } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
private fun BotArchive.State.words() = stringResource(when (this) {
    BotArchive.State.Archived -> R.string.agent_bot_state_archived
    BotArchive.State.NotArchived -> R.string.agent_bot_state_not_archived
    BotArchive.State.Unknown -> R.string.agent_bot_state_unknown
})

/** What Archive Bot couldn't finish, said plainly, until it's dismissed. No chat content, only where things stand. */
@Composable
fun BotArchiveIssueDialog(store: AgentStore) {
    val issue = store.botArchiveIssue ?: return
    val busy = store.archivingBotId != null
    val partial = issue.result as? BotArchive.Result.Partial
    val reason = when (val result = issue.result) {
        is BotArchive.Result.Partial -> result.reason
        is BotArchive.Result.NotChanged -> result.reason.orEmpty()
        BotArchive.Result.Archived -> ""
    }
    val leftArchived = partial?.chats?.values?.count { it == BotArchive.State.Archived } ?: 0
    val leftUnknown = partial?.chats?.values?.count { it == BotArchive.State.Unknown } ?: 0
    val restored = reason == BotArchive.RESTORED
    AlertDialog(
        onDismissRequest = {},
        title = { Text(stringResource(if (partial != null) R.string.agent_archive_bot_unfinished else if (restored) R.string.agent_chats_restored else R.string.agent_bot_not_archived)) },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(reason)
            if (partial != null) {
                Text(stringResource(R.string.agent_bot_archive_state, issue.botTitle, partial.bot.words()), style = MaterialTheme.typography.bodyMedium)
                if (leftArchived + leftUnknown > 0) Text(when {
                    leftArchived > 0 && leftUnknown > 0 -> stringResource(R.string.agent_bot_chats_archived_unknown, leftArchived, leftUnknown)
                    leftArchived > 0 -> stringResource(R.string.agent_bot_chats_archived, leftArchived)
                    else -> stringResource(R.string.agent_bot_chats_unknown, leftUnknown)
                }, style = MaterialTheme.typography.bodyMedium)
            }
        } },
        confirmButton = {
            Row {
                if (leftArchived + leftUnknown > 0) TextButton(enabled = !busy, onClick = { store.restoreBotChats() }) { Text(stringResource(R.string.agent_restore_chats)) }
                if (!restored && store.canArchiveBot(issue.botId)) TextButton(enabled = !busy, onClick = { store.archiveBot(issue.botId) }) {
                    Text(stringResource(if (busy) R.string.agent_working else R.string.try_again))
                }
            }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = { store.dismissBotArchiveIssue() }) { Text(stringResource(R.string.agent_ok)) } },
    )
}
