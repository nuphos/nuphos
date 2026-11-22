package ai.nuphos.android.ui.chat

import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavHostController
import ai.nuphos.android.NuphosApplication
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.ComposerDrafts
import ai.nuphos.android.session.openSharedNewDraft
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** A system share opens an unsent new-chat draft in the current workspace. */
@Composable
fun IncomingShareSheet(nav: NavHostController) {
    val app = LocalContext.current.applicationContext as NuphosApplication
    val resources = androidx.compose.ui.platform.LocalResources.current
    val mailbox = app.incomingShares
    val pending by mailbox.state.collectAsState()
    val mailboxRevision by mailbox.revision.collectAsState()
    val request = pending ?: return
    val auth = LocalAuthSession.current
    val store = LocalAgentStore.current
    val account = auth.user?.id ?: return
    LaunchedEffect(account, request.id) {
        if (auth.user?.id == account && auth.aiAllowed) mailbox.bindAccount(account)
    }
    if (request.accountId != account || !auth.aiAllowed) return
    val bound = remember(account, mailboxRevision) { mailbox.isBound(account) }
    val team = store.selectedTeam
    val workspaceRevision = store.workspaceRevision
    val generation = auth.generation
    var routingError by remember(request.id, team?.id) { mutableStateOf<String?>(null) }
    var routeAttempt by remember(request.id) { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()

    // Choosing publishes destination; it must not cancel the same effect before navigation resumes.
    LaunchedEffect(account, generation, request.id, request.loading, request.error, request.destination, team?.id, workspaceRevision, bound, routeAttempt) {
        if (!bound || team == null || !mailbox.isBound(account)) return@LaunchedEffect
        val key = ComposerDrafts.Key(account, team.id, ComposerDrafts.Destination.NewChat)
        fun current() = auth.generation == generation && auth.user?.id == account && auth.aiAllowed &&
            store.selectedTeam?.id == team.id && store.workspaceRevision == workspaceRevision &&
            mailbox.state.value?.id == request.id && mailbox.state.value?.accountId == account && mailbox.isBound(account)
        try {
            openSharedNewDraft(request, key, ::current, mailbox::choose,
                navigate = { nav.navigate("home") { popUpTo("home"); launchSingleTop = true } },
                release = mailbox::releaseDestination)
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { routingError = resources.getString(R.string.composer_share_open_failed) }
    }
    val loadingWorkspace = team == null && store.teamsPhase in setOf(AgentStore.Phase.Idle, AgentStore.Phase.Loading)
    val problem = request.error ?: routingError ?: if (team == null && !loadingWorkspace)
        stringResource(R.string.composer_share_no_workspace) else null
    // The normal path opens the draft without any dialog; only a problem or an unusually slow
    // preparation (large files, a slow workspace load) shows status with a way to cancel.
    var slow by remember(request.id) { mutableStateOf(false) }
    LaunchedEffect(request.id) { delay(SLOW_SHARE_MILLIS); slow = true }
    if (problem == null && !slow) return
    AlertDialog(
        // Back and outside taps keep the share; only Cancel share discards it.
        onDismissRequest = {},
        title = { Text(if (problem == null) stringResource(R.string.composer_preparing_draft) else stringResource(R.string.composer_open_draft_failed)) },
        text = { Text(problem ?: if (request.loading) stringResource(R.string.composer_preparing_share) else stringResource(R.string.composer_opening_draft)) },
        confirmButton = {
            // Retry reuses the same share and its retained files; invalid input can only be cancelled.
            val retry: (() -> Unit)? = when {
                request.error != null -> if (request.retryable) ({ mailbox.retry(request.id) }) else null
                routingError != null -> ({ routingError = null; routeAttempt++ })
                team == null && store.teamsPhase == AgentStore.Phase.Failed -> ({ scope.launch { store.loadTeams() } })
                else -> null
            }
            if (retry != null) TextButton(onClick = retry) { Text(stringResource(R.string.composer_retry)) }
        },
        dismissButton = { TextButton(onClick = { mailbox.cancel(request.id) }) { Text(stringResource(R.string.composer_cancel_share)) } },
    )
}

private const val SLOW_SHARE_MILLIS = 1_500L
