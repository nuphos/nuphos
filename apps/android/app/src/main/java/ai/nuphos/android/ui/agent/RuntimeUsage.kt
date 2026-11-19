package ai.nuphos.android.ui.agent

import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.Alignment
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
                        if (host?.online == false && devices.none { it.id == host.deviceId && it.box == null }) {
                            // A failed devices read keeps the last list; the catalog alone still says offline.
                            try { devices = api.devices(metrics = false) } catch (error: Exception) { if (error is CancellationException) throw error }
                        }
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

/** How long until a usage window resets: "resets in 2d 5h", "resets in 3h 20m" or
 *  "resets in 12m" once [text] names it. Null when the reset is unknown or past.
 *  Every usage bar and usage-limit notice says it this way, as on Desktop and iOS. */
internal data class ResetsIn(val days: Long, val hours: Long, val minutes: Long) {
    fun text(resources: android.content.res.Resources): String = when {
        days > 0 -> resources.getString(R.string.agent_resets_in_days, days.toInt(), hours.toInt())
        hours > 0 -> resources.getString(R.string.agent_resets_in_hours, hours.toInt(), minutes.toInt())
        else -> resources.getString(R.string.agent_resets_in_minutes, minutes.toInt())
    }

    companion object {
        fun of(at: Instant?, now: Instant = Instant.now()): ResetsIn? {
            val millis = at?.let { java.time.Duration.between(now, it).toMillis() } ?: return null
            if (millis <= 0) return null
            val total = (millis + 59_999) / 60_000
            return ResetsIn(total / 1440, total % 1440 / 60, total % 60)
        }

        fun of(raw: String?, now: Instant = Instant.now()): ResetsIn? =
            of(raw?.let { runCatching { Instant.parse(it) }.getOrNull() }, now)
    }
}

@Composable
internal fun resetsInText(at: ResetsIn?): String? = at?.text(androidx.compose.ui.platform.LocalContext.current.resources)

@Composable
fun RuntimeUsage(quota: RuntimeQuota?, compact: Boolean = false) {
    val locale = java.util.Locale.forLanguageTag(Locale.current.toLanguageTag())
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (quota?.available != true || quota.windows.isEmpty()) {
            Text(stringResource(R.string.agent_usage_unavailable), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            val windows = if (compact) listOf(quota.windows.maxBy { it.usedPercent }) else quota.windows
            // One trailing column for every bar's reset, as wide as the widest the formatter writes,
            // so the bars all end at the same x and the text never moves them as it ticks.
            val resetStyle = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum")
            val widest = listOfNotNull(resetsInText(ResetsIn(0, 23, 59)), resetsInText(ResetsIn(29, 23, 0)))
            val column = windows.any { ResetsIn.of(it.resetsAt) != null }
            windows.forEach { window ->
                val reset = resetsInText(ResetsIn.of(window.resetsAt))
                val left = (100.0 - window.usedPercent).coerceIn(0.0, 100.0)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    ContinuousUsageBar(progress = (left / 100.0).toFloat(), modifier = Modifier.weight(1f))
                    if (column) Box(contentAlignment = Alignment.CenterEnd) {
                        widest.forEach { Text(it, style = resetStyle, color = Color.Transparent, maxLines = 1, modifier = Modifier.clearAndSetSemantics {}) }
                        Text(reset.orEmpty(), style = resetStyle, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                    }
                }
                val percent = String.format(locale, "%.0f", left)
                Text(if (compact) stringResource(R.string.agent_percent_left, percent) else stringResource(R.string.agent_window_percent_left, window.label, percent),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
