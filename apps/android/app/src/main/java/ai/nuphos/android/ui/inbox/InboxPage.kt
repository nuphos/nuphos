package ai.nuphos.android.ui.inbox

import ai.nuphos.android.session.BotQuestion
import ai.nuphos.android.session.OpenQuestions
import ai.nuphos.android.session.returnTime
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Snackbar
import androidx.compose.material3.TextButton
import androidx.compose.ui.text.style.TextOverflow
import java.time.Instant
import ai.nuphos.android.ui.chats.BotQuestionCard
import ai.nuphos.android.ui.chats.rememberQuestionConnect
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.compose.ui.res.stringResource
import ai.nuphos.android.R

/**
 * Desktop's Inbox ("Needs your input"): every open question across the viewer's conversations,
 * newest first, each answered from its card. "From …" opens the conversation that asked. An
 * integration question is answered here, in the asking conversation's credential picker. Snooze sets
 * a question aside until a time, listed below under Snoozed until then; Dismiss closes it, with a
 * reason for the agent if one is typed, after a 5 s Undo.
 */
@Composable
fun InboxPage(inbox: OpenQuestions?, nav: NavHostController, allowed: () -> Boolean) {
    val scope = rememberCoroutineScope()
    val connect = rememberQuestionConnect(inbox, allowed)
    Box(Modifier.fillMaxSize().testTag("inbox")) {
        when {
            inbox == null || !inbox.loaded -> CircularProgressIndicator(Modifier.align(Alignment.Center))
            inbox.waiting.isEmpty() && inbox.snoozed.isEmpty() -> CaughtUp(Modifier.align(Alignment.Center))
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (inbox.waiting.isEmpty()) item(key = "caught-up") { CaughtUp(Modifier.fillMaxWidth()) }
                items(inbox.waiting.asReversed(), key = { it.id }) { question ->
                    BotQuestionCard(question, onOpen = { nav.navigate("conversation/${question.sessionId}") },
                        onAnswer = { text -> if (allowed()) inbox.answer(question, text, scope) },
                        onForm = { body -> if (allowed()) inbox.answer(question, body, scope) },
                        failure = inbox.failures[question.id],
                        answersInPlace = true,
                        onConnect = { connect(question) },
                        onDismiss = { reason -> if (allowed()) inbox.dismiss(question, reason, scope, OpenQuestions.UNDO_MS) },
                        asksReason = true,
                        onSnooze = { until -> if (allowed()) inbox.snooze(question, until, scope) })
                }
                if (inbox.snoozed.isNotEmpty()) item(key = "snoozed") {
                    Snoozed(inbox.snoozed.asReversed(), inbox.failures, onUnsnooze = { inbox.snooze(it, null, scope) })
                }
            }
        }
        if (inbox?.held != null) Snackbar(Modifier.align(Alignment.BottomCenter).padding(16.dp).testTag("inbox-undo"),
            action = { TextButton(onClick = { inbox.undo() }) { Text(stringResource(R.string.shell_inbox_undo)) } }) {
            Text(stringResource(R.string.shell_inbox_dismissed))
        }
    }
}

@Composable
private fun CaughtUp(modifier: Modifier) {
    Column(modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.shell_inbox_empty_title), style = MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.shell_inbox_empty_body),
            style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** The questions snoozed out of the Inbox, below its list: each with when it comes back, and Unsnooze, and why it failed. */
@Composable
private fun Snoozed(questions: List<BotQuestion>, failures: Map<String, String>, onUnsnooze: (BotQuestion) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 8.dp).testTag("inbox-snoozed")) {
        Text(stringResource(R.string.shell_inbox_snoozed), style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        questions.forEach { question ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(question.request.question, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                question.request.snoozedUntil?.let { runCatching { Instant.parse(it) }.getOrNull() }?.let {
                    Text(returnTime(it), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextButton(onClick = { onUnsnooze(question) }, Modifier.testTag("inbox-unsnooze")) {
                    Text(stringResource(R.string.shell_inbox_unsnooze))
                }
            }
            failures[question.id]?.let {
                Text(stringResource(R.string.chats_question_send_failed, it), Modifier.testTag("inbox-snoozed-failure"),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}
