package ai.nuphos.android.data

import kotlinx.serialization.json.*

/** How the conversation's computer stands right now, as its chat tells it. */
sealed interface ComputerPresence {
    data object Online : ComputerPresence
    data object Offline : ComputerPresence
    /** A paused Box: sending a message resumes it. */
    data class Paused(val label: String) : ComputerPresence

    companion object {
        /** Only the device list says an offline Box is paused. A runtime with no computer is online. */
        fun of(host: RuntimeHost?, devices: List<RuntimeDevice>): ComputerPresence {
            if (host?.online != false) return Online
            val device = devices.firstOrNull { it.id == host.deviceId }
            return if (device?.box?.state == "paused") Paused(device.label) else Offline
        }
    }
}

data class RuntimeHost(val deviceId: String?, val deviceLabel: String?, val online: Boolean?, val agentLabel: String? = null)
/** `box`: present only for a Box. */
data class RuntimeDevice(val id: String, val label: String, val online: Boolean, val box: Box?,
    val metricsStatus: String, val cpuPercent: Double?, val memory: Capacity?, val disk: Capacity?, val access: String? = null) {
    val canAddRuntime get() = online && access in setOf("owner", "manage") && (box == null || box.state == "running")
    /** `state`: what instabox says of its machine, such as `paused`. */
    data class Box(val state: String?)
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
        val box = (obj["box"] as? JsonObject)?.let { RuntimeDevice.Box((it["state"] as? JsonPrimitive)?.takeIf { state -> state.isString }?.content) }
        RuntimeDevice(id, text("label") ?: "Computer", online, box, status,
            (metrics?.get("cpuPercent") as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() && it in 0.0..100.0 },
            capacity("memory"), capacity("disk"), text("access"))
    }.also { if (it.map(RuntimeDevice::id).distinct().size != it.size) throw NuphosApi.Failure.InvalidResponse }
}
