package ai.nuphos.android.ui.agent

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.nuphos.android.data.AgentRuntime
import ai.nuphos.android.data.RuntimeDevice
import ai.nuphos.android.data.RuntimeQuota
import ai.nuphos.android.session.runtimeGroups
import ai.nuphos.android.ui.components.RuntimeMark

/** Browsing a computer never changes the runtime. Both composers use this selector. */
@Composable
internal fun RuntimeChoiceList(
    runtimes: List<AgentRuntime>, selectedId: String?, quotas: Map<String, RuntimeQuota>,
    enabled: Boolean, devices: List<RuntimeDevice> = emptyList(), onDetail: ((AgentRuntime) -> Unit)? = null, onSelect: (AgentRuntime) -> Unit,
) {
    val groups = runtimeGroups(runtimes, devices)
    var expanded by remember(selectedId) { mutableStateOf<String?>(null) }
    var initialized by remember(selectedId) { mutableStateOf(false) }
    LaunchedEffect(groups.map { it.key }, selectedId) {
        if (!initialized && groups.isNotEmpty()) {
            expanded = groups.firstOrNull { group -> group.runtimes.any { it.id == selectedId } }?.key ?: groups.first().key
            initialized = true
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
        groups.forEach { group ->
            Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface) {
                Column {
                    Surface(onClick = { expanded = if (expanded == group.key) null else group.key },
                        color = MaterialTheme.colorScheme.surface,
                        modifier = Modifier.semantics { stateDescription = if (expanded == group.key) "Expanded" else "Collapsed" }) {
                        Row(Modifier.fillMaxWidth().padding(20.dp), verticalAlignment = Alignment.Top,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Icon(if (group.key == "cloud") Icons.Outlined.Cloud else if (group.device?.box == true || group.key.startsWith("runtime:")) Icons.Outlined.Inventory2 else Icons.Outlined.Computer, null)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(if (group.key == "cloud") "Cloud" else group.title, style = MaterialTheme.typography.titleMedium)
                                Text("${group.runtimes.size} " + (if (group.runtimes.size == 1) "runtime" else "runtimes") + if (group.runtimes.any { it.id == selectedId }) " · Current" else "",
                                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                group.device?.takeIf { it.online && it.metricsStatus == "live" }?.let { device ->
                                    if (device.cpuPercent != null && device.memory != null && device.disk != null) {
                                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                            RuntimeResourceMeter("CPU", device.cpuPercent, Modifier.weight(1f))
                                            RuntimeResourceMeter("MEM", device.memory.percent.toDouble(), Modifier.weight(1f))
                                            RuntimeResourceMeter("DISK", device.disk.percent.toDouble(), Modifier.weight(1f))
                                        }
                                        if (expanded == group.key) Text("Memory ${runtimeCapacity(device.memory)} · Disk ${runtimeCapacity(device.disk)}",
                                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            }
                            Icon(if (expanded == group.key) Icons.Outlined.ExpandMore else Icons.Outlined.ChevronRight,
                                if (expanded == group.key) "Collapse computer" else "Expand computer")
                        }
                    }
                    if (expanded == group.key) group.runtimes.forEach { runtime ->
                        val displayName = runtime.local?.agentLabel ?: if (runtime.local != null) runtimeProviderName(runtime.provider) else runtime.label
                        HorizontalDivider(Modifier.padding(start = 20.dp))
                        Surface(onClick = { onSelect(runtime) },
                            enabled = enabled && runtime.selectable && runtime.local?.online != false && group.device?.online != false && quotas[runtime.id]?.needsSignIn != true,
                            color = MaterialTheme.colorScheme.surface,
                            modifier = Modifier.fillMaxWidth().semantics { selected = runtime.id == selectedId; role = Role.RadioButton; contentDescription = if (runtime.id == selectedId) "Selected ${runtime.label}" else "Use ${runtime.label}" }) {
                            Row(Modifier.padding(horizontal = 20.dp, vertical = 12.dp).heightIn(min = 48.dp),
                                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                RuntimeMark(runtime.provider, 20.dp)
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(displayName, style = MaterialTheme.typography.titleMedium)
                                    if (displayName != runtimeProviderName(runtime.provider)) Text(runtimeProviderName(runtime.provider),
                                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    when {
                                        runtime.local?.online == false -> Text("Computer offline", style = MaterialTheme.typography.bodySmall)
                                        runtime.signedIn == false -> Text("Sign in required", style = MaterialTheme.typography.bodySmall)
                                        else -> RuntimeUsage(quotas[runtime.id], compact = true)
                                    }
                                }
                                if (onDetail != null) IconButton(onClick = { onDetail(runtime) }) { Icon(Icons.Outlined.Info, "Details for ${runtime.label}") }
                                if (runtime.id == selectedId) Icon(Icons.Outlined.Check, "Selected runtime")
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun runtimeProviderName(provider: String) = ai.nuphos.android.model.RuntimeIdentity.name(provider)
private fun runtimeCapacity(capacity: RuntimeDevice.Capacity) = String.format(java.util.Locale.getDefault(), "%.1f / %.1f GB", capacity.used / 1_073_741_824, capacity.total / 1_073_741_824)

@Composable
private fun RuntimeResourceMeter(title: String, value: Double, modifier: Modifier) {
    val percent = value.coerceIn(0.0, 100.0)
    val tint = if (percent >= 95) MaterialTheme.colorScheme.error else if (percent >= 80) androidx.compose.ui.graphics.Color(0xFFAF601A) else MaterialTheme.colorScheme.primary
    Column(modifier.semantics(mergeDescendants = true) { contentDescription = "$title usage"; stateDescription = "${kotlin.math.round(percent).toInt()} percent used" }, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("${kotlin.math.round(percent).toInt()}%", style = MaterialTheme.typography.bodySmall, color = if (percent >= 80) tint else MaterialTheme.colorScheme.onSurface)
        }
        ContinuousUsageBar(progress = (percent / 100).toFloat(), modifier = Modifier.height(3.dp), color = tint,
            trackColor = MaterialTheme.colorScheme.outlineVariant)
    }
}
