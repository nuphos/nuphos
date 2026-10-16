package ai.nuphos.android.ui.agent

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
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

@Composable
fun RuntimeUsage(quota: RuntimeQuota?) {
    val locale = java.util.Locale.forLanguageTag(Locale.current.toLanguageTag())
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (quota?.available != true || quota.windows.isEmpty()) {
            Text("Usage unavailable", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else quota.windows.forEach { window ->
            val reset = window.resetsAt?.let { raw -> runCatching {
                DateTimeFormatter.ofPattern("MMM d, HH:mm", locale).withZone(ZoneId.systemDefault()).format(Instant.parse(raw))
            }.getOrNull() }
            Text("${window.label}: ${String.format(locale, "%.0f", window.usedPercent)}% used" +
                (reset?.let { " · resets $it" } ?: ""), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
