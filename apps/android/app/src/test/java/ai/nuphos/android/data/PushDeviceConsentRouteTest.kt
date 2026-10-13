package ai.nuphos.android.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PushDeviceConsentRouteTest {
    @Test fun localApiIsBoundToConfiguredLoopbackOrigin() {
        fun request(url: String) = okhttp3.Request.Builder().url(url).build()
        val endpoint = "http://127.0.0.1:18768"
        assertTrue(isLocalApiRequest(request("$endpoint/agent/chat"), endpoint))
        assertFalse(isLocalApiRequest(request("http://127.0.0.1:18769/agent/chat"), endpoint))
        assertFalse(isLocalApiRequest(request("http://localhost:18768/agent/chat"), endpoint))
        assertFalse(isLocalApiRequest(request("https://127.0.0.1:18768/agent/chat"), endpoint))
        assertFalse(isLocalApiRequest(request("$endpoint/agent/chat"), "https://api.nuphos.ai"))
    }
    @Test fun debugEndpointCannotLeakCredentialsToOtherPortsHostsOrRoutes() {
        val endpoint = "http://127.0.0.1:18767"
        fun request(url: String, method: String = "PUT") = okhttp3.Request.Builder().url(url)
            .method(method, if (method == "PUT") okhttp3.RequestBody.create(null, "{}") else null).build()
        assertTrue(isDebugPushRequest(request("$endpoint/push/devices"), true, endpoint))
        assertFalse(isDebugPushRequest(request("$endpoint/push/devices"), false, endpoint))
        assertFalse(isDebugPushRequest(request("http://127.0.0.1:18768/push/devices"), true, endpoint))
        assertFalse(isDebugPushRequest(request("http://localhost:18767/push/devices"), true, endpoint))
        assertFalse(isDebugPushRequest(request("$endpoint/auth/me"), true, endpoint))
        assertFalse(isDebugPushRequest(request("$endpoint/push/devices/extra"), true, endpoint))
        assertFalse(isDebugPushRequest(request("$endpoint/push/devices", "GET"), true, endpoint))
    }
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
