package ai.nuphos.android.ui.agent

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.ui.semantics.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
        val setup = remember { RuntimeSetupStore(api, scope, current, { current() && agents.selectedTeam?.isAdministrator == true }, selection, expired, loginAllowed = { runtime -> current() && inventoryDestination(runtime, agents.selectedTeam?.isAdministrator == true, observations.devices) in setOf(InventoryDestination.CloudDetails, InventoryDestination.ProviderSignIn) }, selectCreatedRuntime = false) }
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
            onManage = { setup.clearSignInFocus(); runtimeId = null; managing = true },
            onRuntime = { setup.clearSignInFocus(); runtimeId = it; managing = true })
        if (managing && setup.isSourceCurrent()) {
            val runtime = runtimeId?.let { id -> observations.runtimes.firstOrNull { it.id == id } }
            val destination = runtime?.let { inventoryDestination(it, team.isAdministrator, observations.devices) }
            val close: () -> Unit = { managing = false; runtimeId = null; observations.refresh() }
            if (runtimeId == null || destination == InventoryDestination.CloudDetails) RuntimeSetupSheet(setup, onDismiss = close,
                quotas = observations.quotas, initialManaging = true, initialRuntimeId = runtimeId, newRuntimeOnly = runtimeId == null, inventoryMode = true, devices = observations.devices)
            else if (runtime != null && destination == InventoryDestination.ProviderSignIn) RuntimeSetupSheet(setup, onDismiss = close,
                quotas = observations.quotas, initialManaging = true, initialSignInRuntimeId = runtime.id, inventoryMode = true, devices = observations.devices)
            else RuntimeInventoryInstructions(runtime, destination, onClose = close)
        }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RuntimeInventory(store: RuntimesStore, canManage: Boolean, onManage: () -> Unit, onRuntime: (String) -> Unit) {
    var userRefreshing by remember(store) { mutableStateOf(false) }
    LaunchedEffect(store.loading) { if (!store.loading) userRefreshing = false }
    androidx.compose.material3.pulltorefresh.PullToRefreshBox(isRefreshing = userRefreshing && store.loading,
        onRefresh = { if (!store.loading) { userRefreshing = true; store.refresh() } },
        modifier = Modifier.fillMaxSize()) {
        if (!store.loaded) {
            Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center) {
                if (store.errors.isNotEmpty()) {
                    Text("Couldn't load runtimes", style = MaterialTheme.typography.titleMedium)
                    store.errors.forEach { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    if (store.loading) CircularProgressIndicator(Modifier.testTag("runtimes-loading"))
                    OutlinedButton(onClick = store::refresh, enabled = !store.loading) { Text("Try again") }
                } else CircularProgressIndicator(Modifier.testTag("runtimes-loading"))
            }
        } else LazyColumn(Modifier.fillMaxSize().testTag("runtime-inventory"), contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)) {
            if (store.errors.isNotEmpty()) item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    store.errors.forEach { Text(it, color = MaterialTheme.colorScheme.error) }
                    TextButton(onClick = store::refresh, enabled = !store.loading) { Text("Try again") }
                }
            }
            if (store.runtimes.isEmpty()) item {
                Column(Modifier.fillMaxWidth().padding(vertical = 32.dp), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Outlined.Cloud, null)
                    Text("No runtimes", style = MaterialTheme.typography.titleMedium)
                    Text(if (canManage) "Add a cloud runtime here, or open Nuphos on your computer to connect a runtime."
                        else "Ask a workspace administrator to add a runtime.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            items(runtimeGroups(store.runtimes, store.devices), key = { it.key }) { group ->
                Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surface) {
                    Column {
                        RuntimeInventoryHost(group)
                        group.runtimes.forEach { runtime ->
                            HorizontalDivider(Modifier.padding(start = 60.dp, end = 20.dp), thickness = (1f / androidx.compose.ui.platform.LocalDensity.current.density).dp, color = MaterialTheme.colorScheme.outlineVariant)
                            Surface(onClick = { onRuntime(runtime.id) }, color = MaterialTheme.colorScheme.surface,
                                modifier = Modifier.fillMaxWidth().testTag("runtime-row-${runtime.id}")) {
                                Row(Modifier.padding(horizontal = 20.dp, vertical = 12.dp).heightIn(min = 48.dp),
                                    verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    Box(Modifier.width(28.dp), contentAlignment = androidx.compose.ui.Alignment.Center) {
                                        ai.nuphos.android.ui.components.RuntimeMark(runtime.provider, 20.dp)
                                    }
                                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                        val provider = inventoryProviderName(runtime.provider)
                                        val name = runtime.local?.agentLabel ?: if (runtime.local != null) provider else runtime.label
                                        Text(name, style = MaterialTheme.typography.titleMedium)
                                        if (name != provider) Text(provider, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        when {
                                            runtime.deleting -> Text("Deleting", style = MaterialTheme.typography.bodySmall)
                                            runtime.status != "active" -> Text("Disabled", style = MaterialTheme.typography.bodySmall)
                                            runtime.local?.online == false || group.device?.online == false -> Text("Offline", style = MaterialTheme.typography.bodySmall)
                                        }
                                        RuntimeInventoryQuota(store.quotas[runtime.id], runtime.signedIn == false)
                                    }
                                    Icon(androidx.compose.material.icons.Icons.AutoMirrored.Outlined.KeyboardArrowRight, null,
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
                                }
                            }
                        }
                    }
                }
            }
            if (canManage) item {
                Surface(onClick = onManage, shape = androidx.compose.foundation.shape.RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 20.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(Icons.Outlined.Add, null, tint = MaterialTheme.colorScheme.primary)
                        Text("Add runtime", color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
    }
}

@Composable
private fun RuntimeInventoryHost(group: RuntimeGroup) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.width(28.dp), contentAlignment = androidx.compose.ui.Alignment.Center) {
            Icon(if (group.key == "cloud") Icons.Outlined.Cloud else if (group.device?.box == true || group.key.startsWith("runtime:"))
                androidx.compose.material.icons.Icons.Outlined.Inventory2 else Icons.Outlined.Computer, null, Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(group.title, style = MaterialTheme.typography.titleMedium, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
            Text("${group.runtimes.size} ${if (group.runtimes.size == 1) "runtime" else "runtimes"}",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            group.device?.takeIf { it.online && it.metricsStatus == "live" && it.cpuPercent != null && it.memory != null && it.disk != null }?.let { device ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    InventoryMeter("CPU", requireNotNull(device.cpuPercent), Modifier.weight(1f))
                    InventoryMeter("MEM", requireNotNull(device.memory).used / device.memory.total * 100, Modifier.weight(1f))
                    InventoryMeter("DISK", requireNotNull(device.disk).used / device.disk.total * 100, Modifier.weight(1f))
                }
                Text("Memory ${inventoryCapacity(requireNotNull(device.memory))} · Disk ${inventoryCapacity(requireNotNull(device.disk))}",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun InventoryMeter(title: String, percent: Double, modifier: Modifier) {
    val tint = if (percent >= 95) MaterialTheme.colorScheme.error else if (percent >= 80) androidx.compose.ui.graphics.Color(0xFFAF601A) else MaterialTheme.colorScheme.primary
    Column(modifier.semantics(mergeDescendants = true) { contentDescription = "$title usage"; stateDescription = "${kotlin.math.round(percent).toInt()} percent used" },
        verticalArrangement = Arrangement.spacedBy(4.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("${kotlin.math.round(percent).toInt()}%", style = MaterialTheme.typography.bodySmall)
        }
        ContinuousUsageBar((percent / 100).toFloat(), Modifier.height(3.dp), tint, MaterialTheme.colorScheme.outlineVariant)
    }
}

@Composable
private fun RuntimeInventoryQuota(quota: ai.nuphos.android.data.RuntimeQuota?, needsSignIn: Boolean) {
    val tightest = quota?.takeIf { it.available }?.windows?.maxByOrNull { it.usedPercent }
    if (tightest != null) {
        val left = kotlin.math.round(100 - tightest.usedPercent).toInt().coerceIn(0, 100)
        val tint = if (left == 0) MaterialTheme.colorScheme.error else if (left <= 20) androidx.compose.ui.graphics.Color(0xFFAF601A) else MaterialTheme.colorScheme.onSurface
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(3.dp), itemVerticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Box(Modifier.width(44.dp)) { ContinuousUsageBar(left / 100f, color = tint, trackColor = MaterialTheme.colorScheme.outlineVariant) }
            Text((if (left == 0) "Limit reached" else "$left% left") + inventoryReset(tightest.resetsAt),
                style = MaterialTheme.typography.bodySmall, color = if (left <= 20) tint else MaterialTheme.colorScheme.onSurfaceVariant)
        }
    } else if (needsSignIn || quota?.needsSignIn == true) Text("Sign in required", style = MaterialTheme.typography.bodySmall,
        color = androidx.compose.ui.graphics.Color(0xFFAF601A))
}
internal fun inventoryProviderName(provider: String) = ai.nuphos.android.model.RuntimeIdentity.name(provider)
private fun inventoryCapacity(value: ai.nuphos.android.data.RuntimeDevice.Capacity) = String.format(java.util.Locale.getDefault(), "%.1f / %.1f GB", value.used / 1_073_741_824, value.total / 1_073_741_824)
private fun inventoryReset(raw: String?): String = runCatching {
    val date = java.time.Instant.parse(raw)
    val minutes = java.time.Duration.between(java.time.Instant.now(), date).toMinutes()
    if (!date.isAfter(java.time.Instant.now())) "" else if (minutes < 60) " · resets in ${minutes.coerceAtLeast(1)}m" else if (minutes < 1440) " · resets in ${minutes / 60}h ${minutes % 60}m"
    else " · resets " + java.time.format.DateTimeFormatter.ofPattern("EEE HH:mm").withZone(java.time.ZoneId.systemDefault()).format(date)
}.getOrDefault("")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun RuntimeInventoryInstructions(runtime: ai.nuphos.android.data.AgentRuntime?, destination: InventoryDestination?, onClose: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.background) {
        RuntimePickerHeader("Sign in", onClose = onClose)
        Column(Modifier.fillMaxWidth().heightIn(max = 640.dp).verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(24.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
            runtime?.let { ai.nuphos.android.ui.components.RuntimeMark(it.provider, 56.dp) }
            val host = runtime?.local?.deviceLabel
            Text(when { runtime == null -> "Runtime unavailable"; destination == InventoryDestination.Unavailable -> "Runtime unavailable"
                host != null -> "Sign in on $host"; else -> "Ask an administrator to sign in" }, style = MaterialTheme.typography.titleMedium)
            runtime?.let { Text(ai.nuphos.android.model.RuntimeIdentity.detail(it.provider, it.label), color = MaterialTheme.colorScheme.onSurfaceVariant) }
            Text(when {
                runtime == null -> "This runtime is no longer in the current workspace. Refresh runtimes before continuing."
                destination == InventoryDestination.Unavailable -> "This runtime is disabled or being removed. Ask an administrator to check its saved state."
                host != null -> "Open Nuphos on $host, go to Settings → Runtimes, then choose Sign in for this runtime."
                else -> "A workspace administrator can sign in to this runtime in Settings → Runtimes."
            }, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = onClose) { Text("Done") }
        }
    }
}
