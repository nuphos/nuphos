package ai.nuphos.android.ui.chat

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import ai.nuphos.android.NuphosApplication
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.session.ComposerDrafts
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers

/** A share never creates a session or sends a message. The destination composer owns that decision. */
@Composable
fun IncomingShareSheet(nav: NavHostController) {
    val app = LocalContext.current.applicationContext as NuphosApplication
    val mailbox = app.incomingShares
    val pending by mailbox.state.collectAsState()
    val request = pending ?: return
    val auth = LocalAuthSession.current
    val store = LocalAgentStore.current
    val account = auth.user?.id ?: return
    LaunchedEffect(account, request.id) { if (auth.user?.id == account && auth.aiAllowed) mailbox.bindAccount(account) }
    if (request.accountId != account || !auth.aiAllowed) return
    val team = store.selectedTeam
    var query by remember(request.id, team?.id) { mutableStateOf("") }
    var rows by remember(request.id, team?.id) { mutableStateOf(emptyList<AgentConversation>()) }
    var error by remember(request.id, team?.id) { mutableStateOf<String?>(null) }
    var loading by remember(request.id, team?.id) { mutableStateOf(false) }
    var choosing by remember(request.id) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(request.id, team?.id, query, request.loading, request.destination) {
        if (team == null || request.loading || request.destination != null) return@LaunchedEffect
        loading = true
        try {
            val found = store.mentionableSessions(team.id, query)
            rows = found.filter { it.readOnly != true && it.archivedAt == null }
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { error = "Could not load agents. Search again to retry." }
        finally { loading = false }
    }
    // Keep cancellation available if a destination fails to open or its composer is unavailable.
    if (request.destination != null && request.error == null) {
        AlertDialog(onDismissRequest = { mailbox.cancel(request.id) }, title = { Text("Opening draft") },
            text = { Text("Your share is waiting for the selected composer. Nothing has been sent.") },
            confirmButton = { TextButton(onClick = { mailbox.cancel(request.id) }) { Text("Cancel share") } })
        return
    }
    fun choose(sessionId: String?) {
        val selected = team ?: return
        val token = auth.token ?: return
        val generation = auth.generation
        choosing = true
        error = null
        scope.launch {
            try {
                if (sessionId != null) {
                    val detail = NuphosApi.conversationDetail(token, selected.id, sessionId)
                    check(detail.readOnly != true && detail.archivedAt == null) { "Choose an active agent you can reply to." }
                }
                withContext(Dispatchers.Main.immediate) {
                    if (auth.generation != generation || auth.user?.id != account || !auth.aiAllowed ||
                        store.selectedTeam?.id != selected.id || mailbox.state.value?.id != request.id) return@withContext
                    val destination = if (sessionId == null) ComposerDrafts.Destination.NewChat else ComposerDrafts.Destination.Chat(sessionId)
                    if (!mailbox.choose(request.id, ComposerDrafts.Key(account, selected.id, destination))) return@withContext
                    if (auth.generation != generation || auth.user?.id != account || !auth.aiAllowed ||
                        store.selectedTeam?.id != selected.id || mailbox.state.value?.id != request.id) return@withContext
                    if (sessionId == null) nav.navigate("home") { popUpTo("home"); launchSingleTop = true }
                    else nav.navigate("conversation/${android.net.Uri.encode(sessionId)}") { popUpTo("home"); launchSingleTop = true }
                }
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) {
                withContext(Dispatchers.Main.immediate) {
                    if (mailbox.state.value?.id == request.id && mailbox.state.value?.destination != null)
                        mailbox.failed(request.id, "Could not open this draft. Cancel this share and try again.")
                    else error = "Could not open this draft. Check access and try again."
                }
            }
            finally { withContext(Dispatchers.Main.immediate) { choosing = false } }
        }
    }
    AlertDialog(
        onDismissRequest = { if (!choosing) mailbox.cancel(request.id) },
        title = { Text("Add share to a draft") },
        text = {
            Column {
                when {
                    request.loading -> Text("Preparing shared content…")
                    request.error != null -> Text(request.error)
                    else -> {
                        if (request.text.isNotBlank()) Text(request.text.take(280))
                        Text("${request.attachments.size} attachments · Nothing will be sent automatically")
                        Text("Workspace")
                        LazyColumn(Modifier.heightIn(max = 120.dp)) {
                            items(store.teams, key = { it.id }) { item ->
                                TextButton(enabled = !choosing, onClick = { error = null; store.select(item) }) {
                                    Text(if (item.id == team?.id) "✓ ${item.name}" else item.name)
                                }
                            }
                        }
                        TextButton(enabled = team != null && !choosing, onClick = { choose(null) }) { Text("New agent draft") }
                        OutlinedTextField(query, onValueChange = { query = it; error = null },
                            modifier = Modifier.fillMaxWidth(), enabled = !choosing, label = { Text("Find an existing agent") })
                        if (loading) Text("Loading agents…")
                        LazyColumn(Modifier.heightIn(max = 220.dp)) {
                            items(rows, key = { it.sessionId }) { row ->
                                TextButton(modifier = Modifier.testTag("incoming-share-agent-${row.sessionId}"), enabled = !choosing, onClick = { choose(row.sessionId) }) { Text(row.displayTitle, maxLines = 2) }
                            }
                        }
                        if (!loading && rows.isEmpty()) Text("No matching agents. Choose a new draft or search again.")
                        error?.let { Text(it) }
                    }
                }
            }
        },
        confirmButton = { TextButton(enabled = !choosing, onClick = { mailbox.cancel(request.id) }) { Text("Cancel share") } },
    )
}
