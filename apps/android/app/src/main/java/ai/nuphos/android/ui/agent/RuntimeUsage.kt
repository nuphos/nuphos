package ai.nuphos.android.ui.agent

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

@Composable
fun RuntimeUsage(quota: RuntimeQuota?, compact: Boolean = false) {
    val locale = java.util.Locale.forLanguageTag(Locale.current.toLanguageTag())
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (quota?.available != true || quota.windows.isEmpty()) {
            Text("Usage unavailable", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else (if (compact) listOf(quota.windows.maxBy { it.usedPercent }) else quota.windows).forEach { window ->
            val reset = window.resetsAt?.let { raw -> runCatching {
                DateTimeFormatter.ofPattern("MMM d, HH:mm", locale).withZone(ZoneId.systemDefault()).format(Instant.parse(raw))
            }.getOrNull() }
            val left = (100.0 - window.usedPercent).coerceIn(0.0, 100.0)
            ContinuousUsageBar(progress = (left / 100.0).toFloat())
            Text((if (compact) "" else "${window.label}: ") + "${String.format(locale, "%.0f", left)}% left" +
                (reset?.let { " · resets $it" } ?: ""), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
