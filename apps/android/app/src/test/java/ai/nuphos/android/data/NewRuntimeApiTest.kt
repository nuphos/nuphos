package ai.nuphos.android.data

import kotlinx.coroutines.test.runTest
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

class NewRuntimeApiTest {
    @Test fun createAndCancelScopeExactDeviceTeamAndInstance() = runTest {
        val id = "00000000-0000-4000-8000-000000000001"
        val requests = mutableListOf<Request>()
        var status = 201
        var body = """{"instanceId":"$id","runtimeId":"created","label":"Codex 2"}"""
        val api = AgentRuntimeApi("synthetic", "507f1f77bcf86cd799439011", OkHttpClient.Builder().addInterceptor {
            requests += it.request()
            Response.Builder().request(it.request()).protocol(Protocol.HTTP_1_1).code(status).message("fixture")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build())
        assertEquals("created", api.create("a/b", "codex", id, " Codex 2 ").runtimeId)
        assertEquals("/agent/devices/a%2Fb/agents", requests.last().url.encodedPath)
        val payload = Buffer().also { requests.last().body!!.writeTo(it) }.readUtf8()
        assertTrue(payload.contains("\"instanceId\":\"$id\"")); assertTrue(payload.contains("507f1f77bcf86cd799439011"))
        status = 204; body = ""; api.discard("a/b", id)
        assertEquals("DELETE", requests.last().method)
        assertEquals("/agent/devices/a%2Fb/agents/$id", requests.last().url.encodedPath)
        assertEquals("507f1f77bcf86cd799439011", requests.last().url.queryParameter("teamId"))
        status = 409; body = """{"error":{"code":"agent_instances_unavailable","message":"Update this host."}}"""
        try { api.create("a/b", "codex", id, "Codex"); fail() } catch (e: RuntimeHttpFailure) { assertEquals("Update this host.", e.serverMessage) }
    }
}
