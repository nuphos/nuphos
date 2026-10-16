package ai.nuphos.android.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable
data class RuntimeQuota(val runtimeId: String, val available: Boolean, val reason: String? = null, val windows: List<Window> = emptyList()) {
    @Serializable
    data class Window(val label: String, val usedPercent: Double, val resetsAt: String? = null)
}

fun decodeRuntimeQuotas(value: JsonObject): Map<String, RuntimeQuota> {
    val entries = value["quotas"] as? JsonArray ?: throw NuphosApi.Failure.InvalidResponse
    return entries.mapNotNull { entry ->
        runCatching { Http.json.decodeFromJsonElement<RuntimeQuota>(entry) }.getOrNull()
            ?.takeIf { quota -> quota.runtimeId.isNotBlank() && quota.windows.all { it.usedPercent.isFinite() && it.usedPercent in 0.0..100.0 } }
    }.associateBy { it.runtimeId }
}
