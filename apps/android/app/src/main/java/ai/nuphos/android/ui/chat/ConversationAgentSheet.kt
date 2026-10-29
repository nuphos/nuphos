package ai.nuphos.android.ui.chat

import androidx.compose.foundation.layout.*
import androidx.compose.ui.Alignment
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import ai.nuphos.android.data.AgentRuntime
import ai.nuphos.android.data.AgentRuntimeApi
import ai.nuphos.android.data.RuntimeQuota
import ai.nuphos.android.session.ChatSession
import ai.nuphos.android.ui.agent.RuntimeUsage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** The current usage stays readable even when changing agents is unavailable. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ConversationAgentSheet(
    session: ChatSession,
    token: String,
    quotas: Map<String, RuntimeQuota>,
    isCurrent: () -> Boolean,
    onDismiss: () -> Unit,
    loadCatalog: (suspend () -> List<AgentRuntime>)? = null,
    onManage: (() -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    val devices = ai.nuphos.android.ui.agent.rememberRuntimeDevices(token, session.teamId)
    var catalog by remember(session) { mutableStateOf<List<AgentRuntime>?>(null) }
    var error by remember(session) { mutableStateOf<String?>(null) }
    var refreshing by remember(session) { mutableStateOf(false) }
    var refresh by remember(session) { mutableIntStateOf(0) }
    var pendingLocal by remember(session) { mutableStateOf<AgentRuntime?>(null) }
    var committing by remember(session) { mutableStateOf(false) }
    LaunchedEffect(session, token, refresh) {
        refreshing = true
        try {
            val loaded = loadCatalog?.invoke() ?: AgentRuntimeApi(token, session.teamId).catalog()
            if (isCurrent()) { catalog = loaded; error = null }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { if (isCurrent()) error = e.message ?: "Could not load runtimes." }
        finally { refreshing = false }
    }
    fun move(target: AgentRuntime) {
        if (!isCurrent() || !session.canMoveAgent || committing) return
        if (catalog?.none { it == target && it.selectable && it.local?.online != false } != false || quotas[target.id]?.needsSignIn == true ||
            target.local?.deviceId?.let { id -> devices.firstOrNull { it.id == id }?.online == false } == true) return
        committing = true
        scope.launch {
            error = null
            try {
                session.moveAgent(target)
                if (isCurrent()) onDismiss()
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                if (isCurrent()) {
                    error = e.message ?: "Could not switch runtimes. Refresh and try again."
                    // Reconcile ambiguous network failures without optimistically changing placement.
                    session.reloadFromServer()
                }
            } finally { committing = false }
        }
    }
    // Keep one expanded anchor and a stable viewport while the catalog loads or changes.
    // Content remains scrollable on short screens and with large text.
    ModalBottomSheet(
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.background,
        onDismissRequest = { if (!session.movingAgent && !committing) onDismiss() },
    ) {
        Column(Modifier.testTag("conversation-runtime-sheet").fillMaxWidth().heightIn(max = 720.dp).fillMaxHeight()) {
            ai.nuphos.android.ui.agent.RuntimePickerHeader(enabled = !session.movingAgent && !committing, onClose = onDismiss)
            HorizontalDivider()
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                if (session.movingAgent || committing) { LinearProgressIndicator(Modifier.fillMaxWidth()); Text("Switching runtime…") }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                if (!session.canManage) Text("You can view this agent's runtime, but cannot move it.")
                else if (!session.canMoveAgent && !session.movingAgent) Text("Wait for the current response or pending message to finish before switching runtimes.")
                if (refreshing) { LinearProgressIndicator(Modifier.fillMaxWidth()); Text("Loading runtimes…") }
                val choices = catalog?.filter { (session.isOwner || it.kind == "managed") && it.selectable &&
                    it.local?.online != false && quotas[it.id]?.needsSignIn != true }
                if (choices != null && choices.isEmpty()) {
                    Text("No available runtimes.", style = MaterialTheme.typography.titleMedium)
                    Text("Set up a cloud runtime, or open Nuphos on your computer to connect a runtime.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (choices != null) ai.nuphos.android.ui.agent.RuntimeChoiceList(choices, session.runtimeId, quotas,
                    enabled = !refreshing && !committing && session.canMoveAgent, devices = devices, onSelect = { target ->
                        if (!isCurrent() || committing || session.movingAgent) return@RuntimeChoiceList
                        if (target.id == session.runtimeId) onDismiss()
                        else if (target.kind == "local") pendingLocal = target
                        else move(target)
                    })
                onManage?.let { manage ->
                    TextButton(enabled = !committing && !session.movingAgent && isCurrent(), onClick = manage) {
                        Text("Manage computers and runtimes")
                    }
                }
                TextButton(enabled = !refreshing && !committing && !session.movingAgent, onClick = { refresh++ }) { Text("Refresh runtimes") }
            }
        }
    }
    pendingLocal?.let { target ->
        AlertDialog(onDismissRequest = { pendingLocal = null }, title = { Text("Move to ${target.label}?") },
            text = { Text("This runtime runs on your computer. After the move, anyone in this team can open this agent and run commands on your computer.") },
            confirmButton = { TextButton(enabled = isCurrent() && session.canMoveAgent, onClick = { pendingLocal = null; move(target) }) { Text("Move") } },
            dismissButton = { TextButton(onClick = { pendingLocal = null }) { Text("Cancel") } })
    }
}
