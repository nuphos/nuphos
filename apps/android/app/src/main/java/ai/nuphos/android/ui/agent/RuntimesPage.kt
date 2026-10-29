package ai.nuphos.android.ui.agent

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import ai.nuphos.android.data.AgentRuntimeApi
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/** A destination, not a runtime picker: inspecting a runtime never changes the composer selection. */
@Composable
fun RuntimesPage() {
    val auth = LocalAuthSession.current
    val agents = LocalAgentStore.current
    val team = agents.selectedTeam
    val account = auth.user?.id
    val token = auth.token
    val authRevision = auth.generation
    val consent = AiAccess.revision
    val workspace = agents.workspaceRevision
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    if (team == null || token == null || account == null || !auth.aiAllowed) return
    key(account, token, authRevision, consent, workspace, team) {
        val access = remember { AiAccess.bind(token) }
        val current = remember { { auth.user?.id == account && auth.token == token && auth.generation == authRevision &&
            auth.aiAllowed && access() && agents.workspaceRevision == workspace && agents.selectedTeam == team } }
        val api = remember { AgentRuntimeApi(token, team.id) }
        val expired = remember { { if (current()) auth.signOut(NuphosApi.Failure.Unauthorized.message) } }
        val observations = remember { RuntimesStore(scope, current, api::catalog, api::quotas, api::devices, expired) }
        val selection = remember { auth.runtimeSelections.bind(account, team.id) }
        val setup = remember { RuntimeSetupStore(api, scope, current, { current() && agents.selectedTeam?.isAdministrator == true }, selection, expired) }
        var managing by remember { mutableStateOf(false) }
        var runtimeId by remember { mutableStateOf<String?>(null) }
        DisposableEffect(observations, setup) { onDispose { observations.close(); setup.close() } }
        LaunchedEffect(observations, lifecycle) {
            lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
                while (isActive && current()) { observations.refresh(); delay(15_000) }
            }
        }
        if (current()) {
        RuntimeInventory(observations, canManage = team.isAdministrator,
            onManage = { runtimeId = null; managing = true },
            onRuntime = { runtimeId = it; managing = true })
        if (managing && setup.isSourceCurrent()) RuntimeSetupSheet(setup, onDismiss = {
            managing = false; runtimeId = null; observations.refresh()
        }, quotas = observations.quotas, initialManaging = true, initialRuntimeId = runtimeId, devices = observations.devices)
        }
    }
}

@Composable
fun RuntimeInventory(store: RuntimesStore, canManage: Boolean, onManage: () -> Unit, onRuntime: (String) -> Unit) {
    LazyColumn(Modifier.fillMaxSize().testTag("runtime-inventory"), contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = store::refresh, enabled = !store.loading) { Text("Refresh runtimes") }
                if (canManage) TextButton(onClick = onManage) { Text("Manage runtimes") }
            }
            if (store.loading) LinearProgressIndicator(Modifier.fillMaxWidth().testTag("runtimes-loading"))
            store.errors.forEach { Text(it, color = MaterialTheme.colorScheme.error) }
            if (!store.loaded && !store.loading && store.errors.isNotEmpty()) Text("Could not load runtimes. Use Refresh runtimes to try again.")
            if (store.loaded && store.runtimes.isEmpty()) Text("No runtimes. Connect a runtime on your computer or ask a workspace administrator to add one.")
        }
        items(runtimeGroups(store.runtimes, store.devices), key = { it.key }) { group ->
            ElevatedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(if (group.key == "cloud") Icons.Outlined.Cloud else Icons.Outlined.Computer, contentDescription = null)
                        Text(group.title, style = MaterialTheme.typography.titleMedium)
                    }
                    group.device?.let { device ->
                        Text(if (!device.online) "Offline" else if (device.metricsStatus == "live") "Online" else "Metrics ${device.metricsStatus}",
                            style = MaterialTheme.typography.bodySmall)
                        if (device.online && device.metricsStatus == "live") {
                            Text("CPU ${device.cpuPercent?.toInt()?.let { "$it%" } ?: "unavailable"}")
                            device.memory?.let { Text("Memory ${it.percent}% · ${capacityGB(it.used)} / ${capacityGB(it.total)} GB") }
                            device.disk?.let { Text("Disk ${it.percent}% · ${capacityGB(it.used)} / ${capacityGB(it.total)} GB") }
                        }
                    }
                    group.runtimes.forEach { runtime ->
                        HorizontalDivider()
                        Text(runtime.label, style = MaterialTheme.typography.titleSmall)
                        val online = group.device?.online ?: runtime.local?.online
                        Text("${runtime.provider} · " + when {
                            runtime.deleting -> "Deleting"
                            runtime.kind == "local" && online == false -> "Offline"
                            runtime.kind == "local" && group.device == null -> "Computer status unavailable"
                            else -> runtime.status.replaceFirstChar { it.uppercase() }
                        }, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        RuntimeUsage(store.quotas[runtime.id])
                        TextButton(onClick = { onRuntime(runtime.id) }, modifier = Modifier.heightIn(min = 48.dp)) {
                            Text("Details: ${runtime.label}")
                        }
                    }
                }
            }
        }
    }
}
private fun capacityGB(bytes: Double): String = String.format(java.util.Locale.getDefault(), "%.0f", bytes / (1024 * 1024 * 1024))
