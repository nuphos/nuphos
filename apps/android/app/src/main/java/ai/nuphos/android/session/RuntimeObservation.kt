package ai.nuphos.android.session

import ai.nuphos.android.data.JsonValue

/** A server document and the monotonic time at which it was observed. */
data class RuntimeObservation(val snapshot: JsonValue, val observedAt: Double) {
    val epoch get() = snapshot["epoch"]?.stringValue
    val revision get() = snapshot["revision"]?.numberValue
    val phase get() = snapshot["phase"]?.stringValue
    fun fresh(now: Double) = now >= observedAt && now - observedAt < 12.0
    fun allows(action: String, now: Double) = fresh(now) && snapshot["schemaVersion"]?.numberValue == 2.0 && snapshot["actions"]?.get(action)?.boolValue == true
    fun accepts(next: RuntimeObservation): Boolean {
        if (epoch != null && epoch == next.epoch && revision != null && next.revision != null && next.revision!! < revision!!) return false
        if (next.observedAt < observedAt && (epoch != next.epoch || revision == next.revision)) return false
        return true
    }
    fun status(now: Double): String? {
        if (!fresh(now) || snapshot["state"]?.stringValue == "disconnected") return "Runtime status unavailable — reconnecting"
        if (snapshot["schemaVersion"]?.numberValue != 2.0) return "Runtime status unavailable — runtime update required"
        if (phase in setOf("idle", "dormant", "cancelled")) return null
        return snapshot["label"]?.stringValue
    }
    companion object {
        fun now(): Double = System.nanoTime() / 1_000_000_000.0
        fun frameObservedAt(received: Double, wallMillis: Double, emittedMillis: Double?): Double =
            if (emittedMillis == null) Double.NEGATIVE_INFINITY else received - maxOf(0.0, wallMillis - emittedMillis) / 1000.0
    }
}

data class SessionPermissions(
    val loaded: Boolean, val loadError: String?, val readOnly: Boolean,
    val isOwner: Boolean, val canCancelRun: Boolean, val canRespondToRun: Boolean,
) {
    val writable get() = loaded && loadError == null && !readOnly
    val manage get() = writable && isOwner
    val cancel get() = writable && (isOwner || canCancelRun)
    val reply get() = writable && canRespondToRun
}

/** Stored JSON frames advance the cursor even when they have no display content. */
class RuntimeFrameCursor(initial: Int = 0) {
    var value = initial
        private set
    fun reset() { value = 0 }
    fun decoded(@Suppress("UNUSED_PARAMETER") frame: JsonValue): Int { value += 1; return value }
}
