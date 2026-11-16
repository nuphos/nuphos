package ai.nuphos.android.ui.inbox

import ai.nuphos.android.model.CredentialSelection
import ai.nuphos.android.session.BotQuestion
import ai.nuphos.android.session.OpenQuestions
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.chat.CredentialPickerSheet
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import kotlinx.coroutines.launch
import androidx.compose.ui.res.stringResource
import ai.nuphos.android.R

/**
 * Desktop's Inbox ("Needs your input"): every open question across the viewer's conversations,
 * newest first, each answered from its card. "From …" opens the conversation that asked. An
 * integration question is answered here, in the asking conversation's credential picker.
 */
@Composable
fun InboxPage(inbox: OpenQuestions?, nav: NavHostController, allowed: () -> Boolean) {
    val scope = rememberCoroutineScope()
    val store = LocalAgentStore.current
    // The integration question whose conversation's credentials are being chosen, with that
    // conversation's selection as edited in the picker.
    var connecting by remember { mutableStateOf<BotQuestion?>(null) }
    var selection by remember { mutableStateOf(CredentialSelection()) }
    connecting?.let { question ->
        // Cancel or a swipe leaves the conversation as it was; Done saves the selection, and the server
        // answers the question it covers, or the card says why not. Only what answers it is offered.
        CredentialPickerSheet(selection, onSelectionChange = { selection = it }, onDismiss = { connecting = null },
            providers = question.request.providers, onConfirm = {
                connecting = null
                if (inbox != null && allowed()) scope.launch { inbox.select(selection, question) }
            })
    }
    Box(Modifier.fillMaxSize().testTag("inbox")) {
        when {
            inbox == null || !inbox.loaded -> CircularProgressIndicator(Modifier.align(Alignment.Center))
            inbox.list.isEmpty() -> Column(Modifier.align(Alignment.Center).padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.shell_inbox_empty_title), style = MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.shell_inbox_empty_body),
                    style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(inbox.list.asReversed(), key = { it.id }) { question ->
                    BotQuestionCard(question, onOpen = { nav.navigate("conversation/${question.sessionId}") },
                        onAnswer = { text -> if (allowed()) inbox.answer(question, text, scope) },
                        onForm = { body -> if (allowed()) inbox.answer(question, body, scope) },
                        failure = inbox.failures[question.id],
                        answersInPlace = true,
                        onConnect = {
                            scope.launch {
                                // The member's own credential: added as named, with no picker and no team connection in its place.
                                val own = question.personalCredentials
                                if (own != null) {
                                    store.loadCredentialOptions()
                                    val connected = store.credentialCatalog?.allItems
                                        ?.filter { it.provider.selectionKey == "personalCredentialIds" }?.map { it.id }?.toSet()
                                    if (allowed()) inbox.useOwn(own, question, connected)
                                } else inbox.storedSelection(question)?.let { selection = it; connecting = question }
                            }
                        })
                }
            }
        }
    }
}
