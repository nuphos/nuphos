package ai.nuphos.android.data

import kotlinx.serialization.json.*

data class RuntimeHost(val deviceId: String?, val deviceLabel: String?, val online: Boolean?, val agentLabel: String? = null)
data class RuntimeDevice(val id: String, val label: String, val online: Boolean, val box: Boolean,
    val metricsStatus: String, val cpuPercent: Double?, val memory: Capacity?, val disk: Capacity?, val access: String? = null) {
    data class Capacity(val used: Double, val total: Double) {
        val percent get() = (used / total * 100).toInt().coerceIn(0, 100)
    }
}

/** Only display fields are retained. No host address, account or Box credentials. */
fun decodeRuntimeDevices(value: JsonObject): List<RuntimeDevice> {
    val devices = value["devices"] as? JsonArray ?: throw NuphosApi.Failure.InvalidResponse
    return devices.map { entry ->
        val obj = entry as? JsonObject ?: throw NuphosApi.Failure.InvalidResponse
        fun text(key: String) = (obj[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val id = text("deviceId")?.takeIf { it.isNotBlank() && it.length <= 200 } ?: throw NuphosApi.Failure.InvalidResponse
        val online = (obj["online"] as? JsonPrimitive)?.booleanOrNull == true
        val status = text("metricsStatus") ?: "unavailable"
        val metrics = (obj["metrics"] as? JsonObject)?.takeIf { online && status == "live" }
        fun capacity(key: String): RuntimeDevice.Capacity? {
            val capacity = metrics?.get(key) as? JsonObject ?: return null
            val used = (capacity["used"] as? JsonPrimitive)?.doubleOrNull ?: return null
            val total = (capacity["total"] as? JsonPrimitive)?.doubleOrNull ?: return null
            return if (used.isFinite() && total.isFinite() && used >= 0 && total > 0 && used <= total)
                RuntimeDevice.Capacity(used, total) else null
        }
        RuntimeDevice(id, text("label") ?: "Computer", online, obj["box"] is JsonObject, status,
            (metrics?.get("cpuPercent") as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() && it in 0.0..100.0 },
            capacity("memory"), capacity("disk"), text("access"))
    }.also { if (it.map(RuntimeDevice::id).distinct().size != it.size) throw NuphosApi.Failure.InvalidResponse }
}
