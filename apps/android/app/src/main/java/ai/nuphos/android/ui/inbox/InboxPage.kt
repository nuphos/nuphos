package ai.nuphos.android.ui.inbox

import ai.nuphos.android.R
import ai.nuphos.android.session.BotQuestions
import ai.nuphos.android.session.OpenQuestions
import ai.nuphos.android.ui.chats.BotQuestionCard
import ai.nuphos.android.ui.chats.rememberQuestionConnect
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import kotlinx.coroutines.launch

/** Questions grouped by their Bot or Task, with one answer card open at a time. */
@Composable
fun InboxPage(inbox: OpenQuestions?, nav: NavHostController, allowed: () -> Boolean) {
    val scope = rememberCoroutineScope()
    val connect = rememberQuestionConnect(inbox, allowed)
    var selectedId by rememberSaveable(inbox?.workspaceId) { mutableStateOf<String?>(null) }
    val listState = key(inbox?.workspaceId) { rememberLazyListState() }
    val questions = inbox?.list.orEmpty()
    val groups = BotQuestions.grouped(questions)
    val selected = questions.firstOrNull { it.id == selectedId }

    LaunchedEffect(inbox, selectedId, selected) {
        if (inbox?.loaded == true && selected == null) selectedId = null
    }
    BackHandler(enabled = selected != null) { selectedId = null }

    Box(Modifier.fillMaxSize().testTag("inbox")) {
        when {
            inbox == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
            !inbox.loaded -> {
                val failure = inbox.loadFailure
                if (failure == null) {
                    CircularProgressIndicator(Modifier.align(Alignment.Center))
                } else {
                    Column(
                        Modifier.align(Alignment.Center).padding(32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(failure, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
                        Button(onClick = { scope.launch { inbox.refresh() } }) {
                            Text(stringResource(R.string.shell_retry))
                        }
                    }
                }
            }
            selected != null -> key(selected.id) {
                fun advance() {
                    val ordered = groups.flatten()
                    val index = ordered.indexOfFirst { it.id == selected.id }
                    selectedId = (ordered.getOrNull(index + 1) ?: ordered.firstOrNull())
                        ?.takeUnless { it.id == selected.id }?.id
                }

                LazyColumn(
                    Modifier.fillMaxSize().testTag("inbox-detail"),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                ) {
                    item {
                        TextButton(onClick = { selectedId = null }) {
                            Text(stringResource(R.string.chat_back))
                        }
                        BotQuestionCard(
                            selected,
                            onOpen = { nav.navigate("conversation/${selected.sessionId}") },
                            onAnswer = { answer -> if (allowed()) {
                                advance()
                                inbox.answer(selected, answer, scope)
                            } },
                            onForm = { body -> if (allowed()) {
                                advance()
                                inbox.answer(selected, body, scope)
                            } },
                            failure = inbox.failures[selected.id],
                            answersInPlace = true,
                            onConnect = { connect(selected) },
                        )
                        if (questions.size > 1) {
                            TextButton(onClick = ::advance) {
                                Text(stringResource(R.string.shell_inbox_skip))
                            }
                        }
                    }
                }
            }
            groups.isEmpty() -> Column(
                Modifier.align(Alignment.Center).padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(stringResource(R.string.shell_inbox_empty_title), style = MaterialTheme.typography.titleMedium)
                Text(
                    stringResource(R.string.shell_inbox_empty_body),
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            else -> LazyColumn(
                Modifier.fillMaxSize(),
                state = listState,
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            ) {
                groups.forEach { group ->
                    val source = group.first()
                    item(key = "source:${source.sourceId}") {
                        Text(
                            source.sourceTitle,
                            modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp)
                                .testTag("inbox-source"),
                            style = MaterialTheme.typography.titleSmall,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    items(group, key = { it.id }) { question ->
                        val failure = inbox.failures[question.id]
                        ListItem(
                            headlineContent = {
                                Text(question.request.question, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            },
                            supportingContent = {
                                if (question.sourceId != question.sessionId) Text(question.title)
                                if (failure != null) {
                                    Text(
                                        stringResource(R.string.chats_question_send_failed, failure),
                                        color = MaterialTheme.colorScheme.error,
                                    )
                                }
                            },
                            modifier = Modifier.fillMaxWidth().clickable { selectedId = question.id }
                                .testTag("inbox-question"),
                        )
                    }
                }
            }
        }
    }
}
