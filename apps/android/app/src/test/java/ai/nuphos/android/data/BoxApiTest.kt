package ai.nuphos.android.data

import kotlinx.coroutines.test.runTest
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

class BoxApiTest {
    @Test fun flagsCreatePayloadResumeAndPlanReason() = runTest {
        val requests = mutableListOf<Request>()
        var status = 200
        var body = """{"devices":[],"boxAvailable":true,"canCreateBox":true}"""
        val api = BoxApi("synthetic", "507f1f77bcf86cd799439011", OkHttpClient.Builder().addInterceptor {
            requests += it.request()
            Response.Builder().request(it.request()).protocol(Protocol.HTTP_1_1).code(status).message("fixture").body(body.toResponseBody(Http.jsonMedia)).build()
        }.build())
        assertTrue(api.inventory().offered)
        body = """{"devices":[],"boxAvailable":true}"""; assertFalse(api.inventory().offered)
        status = 201; body = """{"deviceId":"made"}"""
        assertEquals("made", api.createBox(" Computer 2 "))
        assertEquals("/agent/devices/boxes", requests.last().url.encodedPath)
        val payload = Buffer().also { requests.last().body!!.writeTo(it) }.readUtf8()
        assertTrue(payload.contains("\"teamId\":\"507f1f77bcf86cd799439011\"")); assertTrue(payload.contains("\"label\":\"Computer 2\""))
        status = 200; body = "{}"; api.resumeBox("a/b")
        assertEquals("/agent/devices/a%2Fb/box/resume", requests.last().url.encodedPath)
        assertEquals("507f1f77bcf86cd799439011", requests.last().url.queryParameter("teamId"))
        status = 402; body = """{"error":{"code":"box_vcpu_limit","message":"Choose a larger plan."}}"""
        try { api.createBox("Computer"); fail() } catch (e: RuntimeHttpFailure) { assertEquals(402, e.status); assertEquals("Choose a larger plan.", e.serverMessage) }
    }
}
