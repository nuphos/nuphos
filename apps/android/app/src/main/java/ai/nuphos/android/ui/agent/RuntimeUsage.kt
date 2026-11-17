package ai.nuphos.android.ui.agent

import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.Modifier
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import ai.nuphos.android.data.AgentRuntimeApi
import ai.nuphos.android.data.ComputerPresence
import ai.nuphos.android.data.RuntimeQuota
import ai.nuphos.android.session.AiAccess
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import androidx.compose.ui.text.intl.Locale

/** One team snapshot, refreshed only while this screen is resumed. Errors never gate chat. */
@Composable
fun rememberRuntimeQuotas(token: String?, teamId: String?): Map<String, RuntimeQuota> {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val revision = AiAccess.revision
    return key(token, teamId, revision, lifecycle) {
        val quotas by produceState<Map<String, RuntimeQuota>>(emptyMap()) {
            if (token == null || teamId == null) return@produceState
            val allowed = AiAccess.bind(token)
            lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
                while (isActive && allowed()) {
                    val result = try { AgentRuntimeApi(token, teamId).quotas() }
                    catch (e: Exception) { if (e is CancellationException) throw e; emptyMap() }
                    if (allowed()) value = result
                    delay(60_000)
                }
            }
        }
        quotas
    }
}

/** Device observations are scoped to the same foreground account/team as quotas. */
@Composable
internal fun rememberRuntimeDevices(token: String?, teamId: String?): List<ai.nuphos.android.data.RuntimeDevice> {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val revision = AiAccess.revision
    return key(token, teamId, revision, lifecycle) {
        val devices by produceState<List<ai.nuphos.android.data.RuntimeDevice>>(emptyList()) {
            if (token == null || teamId == null) return@produceState
            val allowed = AiAccess.bind(token)
            lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
                while (isActive && allowed()) {
                    val result = try { AgentRuntimeApi(token, teamId).devices() }
                    catch (error: Exception) { if (error is CancellationException) throw error; emptyList() }
                    if (allowed()) value = result
                    delay(5_000)
                }
            }
        }
        devices
    }
}

/** How the computer this runtime lives on stands right now. A runtime with no computer is never asked again. */
@Composable
internal fun rememberComputerPresence(token: String?, teamId: String?, runtimeId: String?): ComputerPresence {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val revision = AiAccess.revision
    return key(token, teamId, runtimeId, revision, lifecycle) {
        val presence by produceState<ComputerPresence>(ComputerPresence.Online) {
            if (token == null || teamId == null || runtimeId == null) return@produceState
            val allowed = AiAccess.bind(token)
            // Kept across a failed read, so one dropped request never turns a paused Box offline.
            var devices = emptyList<ai.nuphos.android.data.RuntimeDevice>()
            lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
                while (isActive && allowed()) {
                    try {
                        val api = AgentRuntimeApi(token, teamId)
                        val host = api.catalog().firstOrNull { it.id == runtimeId }?.local
                        // Only an offline Box can be paused; a computer known not to be a Box is not asked again.
                        if (host?.online == false && devices.none { it.id == host.deviceId && it.box == null }) devices = api.devices(metrics = false)
                        if (allowed()) value = ComputerPresence.of(host, devices)
                        if (host == null) return@repeatOnLifecycle
                    } catch (error: Exception) { if (error is CancellationException) throw error }
                    delay(15_000)
                }
            }
        }
        presence
    }
}

@Composable
fun RuntimeUsage(quota: RuntimeQuota?, compact: Boolean = false) {
    val locale = java.util.Locale.forLanguageTag(Locale.current.toLanguageTag())
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (quota?.available != true || quota.windows.isEmpty()) {
            Text(stringResource(R.string.agent_usage_unavailable), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else (if (compact) listOf(quota.windows.maxBy { it.usedPercent }) else quota.windows).forEach { window ->
            val reset = window.resetsAt?.let { raw -> runCatching {
                DateTimeFormatter.ofPattern("MMM d, HH:mm", locale).withZone(ZoneId.systemDefault()).format(Instant.parse(raw))
            }.getOrNull() }
            val left = (100.0 - window.usedPercent).coerceIn(0.0, 100.0)
            ContinuousUsageBar(progress = (left / 100.0).toFloat())
            val percent = String.format(locale, "%.0f", left)
            Text((if (compact) stringResource(R.string.agent_percent_left, percent) else stringResource(R.string.agent_window_percent_left, window.label, percent)) +
                (reset?.let { " · " + stringResource(R.string.agent_resets_at, it) } ?: ""), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
