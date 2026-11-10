package ai.nuphos.android.ui.inbox

import ai.nuphos.android.session.OpenQuestions
import ai.nuphos.android.ui.chats.BotQuestionCard
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

/**
 * Desktop's Inbox ("Needs your input"): every open question across the viewer's conversations,
 * newest first, each answered from its card. "From …" opens the conversation that asked.
 */
@Composable
fun InboxPage(inbox: OpenQuestions?, nav: NavHostController, allowed: () -> Boolean) {
    val scope = rememberCoroutineScope()
    Box(Modifier.fillMaxSize().testTag("inbox")) {
        when {
            inbox == null || !inbox.loaded -> CircularProgressIndicator(Modifier.align(Alignment.Center))
            inbox.list.isEmpty() -> Column(Modifier.align(Alignment.Center).padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("You're all caught up", style = MaterialTheme.typography.titleMedium)
                Text("When an agent needs you to decide something, it shows up here. Answer it and it leaves the Inbox.",
                    style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(inbox.list.asReversed(), key = { it.id }) { question ->
                    BotQuestionCard(question, onOpen = { nav.navigate("conversation/${question.sessionId}") },
                        onAnswer = { text -> if (allowed()) inbox.answer(question, text, scope) },
                        failure = inbox.failures[question.id])
                }
            }
        }
    }
}
