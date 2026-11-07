package ai.nuphos.android.ui.agent

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
    val bot = store.conversations.firstOrNull { it.sessionId == botId }
    var started by remember(botId) { mutableStateOf(false) }
    val busy = store.archivingBotId == botId
    // Done, or reported by the dialog below.
    LaunchedEffect(started, busy) { if (started && !busy) onDismiss() }
    if (bot == null || (!started && !store.canArchiveBot(botId))) { LaunchedEffect(Unit) { onDismiss() }; return }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Archive Bot?") },
        text = { Text("“${bot.displayTitle}” and your chats with it are archived together.") },
        confirmButton = { TextButton(enabled = !busy, onClick = { started = true; store.archiveBot(botId) }) {
            Text(if (busy) "Archiving…" else "Archive")
        } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Cancel") } },
    )
}

private fun BotArchive.State.words() = when (this) {
    BotArchive.State.Archived -> "archived"
    BotArchive.State.NotArchived -> "not archived"
    BotArchive.State.Unknown -> "unknown, as its request didn't get an answer"
}

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
        title = { Text(if (partial != null) "Archive Bot didn't finish" else if (restored) "Chats restored" else "Bot not archived") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(reason)
            if (partial != null) {
                Text("“${issue.botTitle}”: ${partial.bot.words()}.", style = MaterialTheme.typography.bodyMedium)
                if (leftArchived + leftUnknown > 0) Text(buildString {
                    append("Your chats with it: ")
                    append(listOfNotNull(
                        leftArchived.takeIf { it > 0 }?.let { "$it archived" },
                        leftUnknown.takeIf { it > 0 }?.let { "$it unknown" },
                    ).joinToString(", "))
                    append(".")
                }, style = MaterialTheme.typography.bodyMedium)
            }
        } },
        confirmButton = {
            Row {
                if (leftArchived + leftUnknown > 0) TextButton(enabled = !busy, onClick = { store.restoreBotChats() }) { Text("Restore chats") }
                if (!restored && store.canArchiveBot(issue.botId)) TextButton(enabled = !busy, onClick = { store.archiveBot(issue.botId) }) {
                    Text(if (busy) "Working…" else "Try again")
                }
            }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = { store.dismissBotArchiveIssue() }) { Text("OK") } },
    )
}
