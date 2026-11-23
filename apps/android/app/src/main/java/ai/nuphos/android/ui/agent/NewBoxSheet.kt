package ai.nuphos.android.ui.agent

import ai.nuphos.android.R
import ai.nuphos.android.data.*
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Reused by the first-runtime prompt and Computers & runtimes. */
@Composable
internal fun ConnectComputerFlow(onDismiss: () -> Unit) {
    val auth = LocalAuthSession.current
    val agents = LocalAgentStore.current
    val account = auth.user?.id ?: return
    val token = auth.token ?: return
    val team = agents.selectedTeam ?: return
    val generation = auth.generation
    val consent = AiAccess.revision
    val workspace = agents.workspaceRevision
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    key(account, token, generation, consent, team, workspace) {
        val access = remember { AiAccess.bind(token) }
        val current = remember { { auth.user?.id == account && auth.token == token && auth.generation == generation &&
            auth.aiAllowed && access() && agents.workspaceRevision == workspace && agents.selectedTeam == team } }
        val api = remember { AgentRuntimeApi(token, team.id) }
        val expired = remember { { if (current()) auth.signOut(NuphosApi.Failure.Unauthorized.message) } }
        val store = remember { NewBoxStore(BoxApi(token, team.id), api::catalog, scope, current, expired) }
        DisposableEffect(store) { onDispose { store.close() } }
        LaunchedEffect(store, lifecycle) {
            lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
                while (isActive && current()) {
                    store.refresh()
                    delay(if (store.deviceId != null) 1_000 else 15_000)
                }
            }
        }
        if (current()) NewBoxSheet(store, onDismiss) { runtime, close ->
            key(runtime.id) {
                val selection = remember { RuntimeSelections.Selection(account, team.id).also { it.saveCatalog(store.runtimes) } }
                val setup = remember { RuntimeSetupStore(api, scope, current, { false }, selection, expired,
                    loginAllowed = { row -> current() && store.inventory.devices.any { it.id == row.local?.deviceId && it.canAddRuntime } }, useSelectedRuntime = false) }
                DisposableEffect(setup) { onDispose { setup.close(); selection.invalidate() } }
                RuntimeSetupSheet(setup, onDismiss = close, initialManaging = true, initialSignInRuntimeId = runtime.id, inventoryMode = true, devices = store.inventory.devices)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NewBoxSheet(store: NewBoxStore, onDismiss: () -> Unit,
    signIn: @Composable (AgentRuntime, () -> Unit) -> Unit) {
    var creatingBox by remember { mutableStateOf(false) }
    var login by remember { mutableStateOf<AgentRuntime?>(null) }
    login?.let { runtime -> signIn(runtime) { login = null }; return }
    ModalBottomSheet(onDismissRequest = { if (!store.busy) onDismiss() },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        properties = ModalBottomSheetProperties(shouldDismissOnBackPress = !store.busy), containerColor = MaterialTheme.colorScheme.background) {
        RuntimePickerHeader(stringResource(if (creatingBox) R.string.box_title else R.string.box_setup), onClose = { if (!store.busy) onDismiss() })
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            if (!creatingBox) {
                Text(stringResource(R.string.box_connect), style = MaterialTheme.typography.titleLarge)
                Text(stringResource(R.string.box_guide_body))
                if (store.loaded && store.inventory.offered) Surface(onClick = { creatingBox = true }, shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth().testTag("new-box")) {
                    Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(Icons.Outlined.Inventory2, null, Modifier.size(20.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(stringResource(R.string.box_title), style = MaterialTheme.typography.titleSmall)
                            Text(stringResource(R.string.box_description), style = MaterialTheme.typography.bodySmall)
                        }
                        Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, Modifier.size(20.dp))
                    }
                }
                Text(stringResource(R.string.box_step1)); Text(stringResource(R.string.box_step2)); Text(stringResource(R.string.box_step3))
                val uri = androidx.compose.ui.platform.LocalUriHandler.current
                TextButton(onClick = { uri.openUri("https://nuphos.ai") }) { Text(stringResource(R.string.box_visit)) }
            } else when (store.phase) {
                NewBox.Phase.Idle -> {
                    Text(stringResource(R.string.box_body))
                    OutlinedTextField(store.name, { store.name = it }, enabled = !store.busy && !store.uncertain,
                        label = { Text(stringResource(R.string.box_name)) }, placeholder = { Text(store.placeholder) }, singleLine = true,
                        modifier = Modifier.fillMaxWidth().testTag("box-name"))
                    Text(stringResource(R.string.box_name_help, store.placeholder))
                    Button(onClick = store::create, enabled = store.canCreate, modifier = Modifier.testTag("box-create")) {
                        Text(stringResource(if (store.busy) R.string.box_creating else R.string.box_create))
                    }
                }
                NewBox.Phase.Starting -> { LinearProgressIndicator(Modifier.fillMaxWidth()); Text(stringResource(R.string.box_starting)) }
                NewBox.Phase.Ready -> {
                    Text(stringResource(R.string.box_ready))
                    store.agents.forEach { runtime ->
                        OutlinedButton(onClick = { login = runtime }, modifier = Modifier.fillMaxWidth().testTag("box-login-${runtime.id}")) {
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                ai.nuphos.android.ui.components.RuntimeMark(runtime.provider, 20.dp)
                                Text(runtime.local?.agentLabel ?: inventoryProviderName(runtime.provider))
                            }
                        }
                    }
                }
                NewBox.Phase.Error -> Text(stringResource(R.string.box_failed), color = MaterialTheme.colorScheme.error)
                NewBox.Phase.Timeout -> Text(stringResource(R.string.box_timeout), color = MaterialTheme.colorScheme.error)
            }
            store.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (store.planFailure) Text(stringResource(R.string.box_plan))
            if (store.uncertain) Text(stringResource(R.string.box_uncertain))
        }
    }
}

@Composable
internal fun BoxResumeButton(device: RuntimeDevice, onResumed: () -> Unit) {
    if (!NewBox.resumable(device)) return
    val auth = LocalAuthSession.current
    val agents = LocalAgentStore.current
    val token = auth.token ?: return
    val team = agents.selectedTeam ?: return
    val generation = auth.generation
    val consent = AiAccess.revision
    val workspace = agents.workspaceRevision
    val access = remember(token, generation, consent, workspace, team) { AiAccess.bind(token) }
    val scope = rememberCoroutineScope()
    var busy by remember(device.id) { mutableStateOf(false) }
    var error by remember(device.id) { mutableStateOf<String?>(null) }
    val current = { auth.token == token && auth.generation == generation && auth.aiAllowed && access() && agents.workspaceRevision == workspace && agents.selectedTeam == team }
    if (NewBox.resumable(device)) {
        // Pulled back by the button's own padding so its label starts on the row's text column.
        TextButton(enabled = !busy, modifier = Modifier.offset(x = (-12).dp), onClick = {
            if (!current()) return@TextButton
            busy = true; error = null
            scope.launch {
                try {
                    val api = BoxApi(token, team.id)
                    val fresh = api.inventory().devices.firstOrNull { it.id == device.id }
                    if (current() && fresh != null && NewBox.resumable(fresh)) { api.resumeBox(device.id); if (current()) onResumed() }
                } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) {
                    if (current()) { if (e is NuphosApi.Failure.Unauthorized) auth.signOut(NuphosApi.Failure.Unauthorized.message)
                        else error = (e as? RuntimeHttpFailure)?.serverMessage ?: ai.nuphos.android.model.Words(R.string.box_resume_failed) }
                } finally { busy = false }
            }
        }) { Text(stringResource(R.string.box_resume)) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}
