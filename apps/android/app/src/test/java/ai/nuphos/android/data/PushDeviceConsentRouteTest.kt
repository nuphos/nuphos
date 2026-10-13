package ai.nuphos.android.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PushDeviceConsentRouteTest {
    @Test fun onlyRegistrationAndUnregistrationBypassConsent() {
        assertTrue(isPushDeviceAccountRequest("PUT", listOf("push", "devices")))
        assertTrue(isPushDeviceAccountRequest("DELETE", listOf("push", "devices", "AbC:opaque")))
        assertFalse(isPushDeviceAccountRequest("GET", listOf("push", "devices")))
        assertFalse(isPushDeviceAccountRequest("PUT", listOf("push", "devicesFoo")))
        assertFalse(isPushDeviceAccountRequest("PUT", listOf("push", "devices", "extra")))
        assertFalse(isPushDeviceAccountRequest("DELETE", listOf("push", "devices", "token", "extra")))
        assertFalse(isPushDeviceAccountRequest("DELETE", listOf("push", "devices", "")))
    }
}
