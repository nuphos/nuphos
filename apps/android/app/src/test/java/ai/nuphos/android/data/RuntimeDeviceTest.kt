package ai.nuphos.android.data

import kotlinx.serialization.json.jsonObject
import org.junit.Assert.*
import org.junit.Test

class RuntimeDeviceTest {
    private fun decode(online: Boolean = true, status: String = "live", cpu: String = "22", used: String = "6", total: String = "16") = decodeRuntimeDevices(Http.json.parseToJsonElement("""{"devices":[{"deviceId":"host","label":"Host","online":$online,"metricsStatus":"$status","box":{},"metrics":{"cpuPercent":$cpu,"memory":{"used":$used,"total":$total}}}]}""").jsonObject).single()
    @Test fun metricsRequireLiveOnlineAndValidCapacity() {
        assertEquals(22.0, decode().cpuPercent!!, 0.0); assertEquals(37, decode().memory!!.percent)
        assertNull(decode(online = false).memory); assertNull(decode(status = "waiting").cpuPercent)
        assertNull(decode(cpu = "101").cpuPercent); assertNull(decode(used = "17").memory)
        assertNull(decode(total = "0").memory); assertNull(decode(used = "-1").memory)
    }
    @Test fun duplicateDeviceIdentityIsRejected() {
        val item = """{"deviceId":"same","online":false}"""
        assertThrows(Exception::class.java) { decodeRuntimeDevices(Http.json.parseToJsonElement("""{"devices":[$item,$item]}""").jsonObject) }
    }
}
