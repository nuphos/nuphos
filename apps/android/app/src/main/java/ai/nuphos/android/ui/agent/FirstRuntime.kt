package ai.nuphos.android.ui.agent

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.runtime.*
import ai.nuphos.android.data.AgentRuntimeApi
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.RuntimeSetupStore
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession

/** What Bots and an empty Tasks show while the workspace has no runtime, as on iOS. Only an administrator can set one up. */
@Composable
fun FirstRuntimePrompt(onSetUp: (() -> Unit)?) {
    EmptyState(
        icon = Icons.Outlined.Memory,
        title = "Connect your first runtime",
        body = if (onSetUp != null) "Create a cloud runtime and sign in with your AI provider."
            else "Ask a workspace administrator to connect a cloud runtime, or open Nuphos on your computer to connect your own local runtime.",
        action = if (onSetUp != null) "Set up runtime" else null,
        onAction = onSetUp,
    )
}

/**
 * The Runtimes page's New Runtime flow, opened from the prompt. Hosted by the page rather than the
 * prompt, so it stays open through sign-in once the new runtime replaces the prompt.
 */
@Composable
fun FirstRuntimeSetup(onClose: () -> Unit) {
    val auth = LocalAuthSession.current
    val agents = LocalAgentStore.current
    val team = agents.selectedTeam
    val account = auth.user?.id
    val token = auth.token
    val authRevision = auth.generation
    val consent = AiAccess.revision
    val workspace = agents.workspaceRevision
    val scope = rememberCoroutineScope()
    if (team == null || token == null || account == null || !auth.aiAllowed) { LaunchedEffect(Unit) { onClose() }; return }
    key(account, token, authRevision, consent, workspace, team) {
        val access = remember { AiAccess.bind(token) }
        val current = remember { { auth.user?.id == account && auth.token == token && auth.generation == authRevision &&
            auth.aiAllowed && access() && agents.workspaceRevision == workspace && agents.selectedTeam == team } }
        val expired = remember { { if (current()) auth.signOut(NuphosApi.Failure.Unauthorized.message) } }
        val setup = remember {
            RuntimeSetupStore(AgentRuntimeApi(token, team.id), scope, current,
                { current() && agents.selectedTeam?.isAdministrator == true }, auth.runtimeSelections.bind(account, team.id), expired)
        }
        val quotas = rememberRuntimeQuotas(token, team.id)
        // A new runtime shows up underneath as soon as it exists, as on iOS.
        LaunchedEffect(setup.state.catalogRevision) { if (setup.selection.catalog.isNotEmpty()) agents.refreshRuntimes() }
        val close = { agents.refreshRuntimes(); onClose() }
        if (setup.isSourceCurrent()) RuntimeSetupSheet(setup, onDismiss = close, quotas = quotas,
            initialManaging = true, newRuntimeOnly = true, inventoryMode = true)
        else LaunchedEffect(Unit) { onClose() }
    }
}
