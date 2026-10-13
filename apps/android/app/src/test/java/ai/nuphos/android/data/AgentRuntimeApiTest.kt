package ai.nuphos.android.data

import kotlinx.coroutines.test.runTest
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

class AgentRuntimeApiTest {
    private var status = 200
    private val runtime = """{"id":"saved-id","provider":"codex","label":"Saved","status":"active","kind":"managed","defaults":{"secret":"must-not-be-kept"}}"""
    private val attemptId = "00000000-0000-4000-8000-000000000001"
    private var response = """{"runtimes":[$runtime]}"""
    private val requests = mutableListOf<Request>()
    private val api = AgentRuntimeApi("synthetic", "507f1f77bcf86cd799439011", OkHttpClient.Builder().addInterceptor {
        requests += it.request()
        Response.Builder().request(it.request()).protocol(Protocol.HTTP_1_1).code(status).message("fixture")
            .body(response.toResponseBody(Http.jsonMedia)).build()
    }.build())
    private fun payload() = Buffer().also { requests.last().body!!.writeTo(it) }.readUtf8()
    private fun login(state: String = "awaiting_authorization") = """{"attemptId":"$attemptId","state":"$state","expiresAt":"2030-01-01T00:00:00Z","verificationUri":"https://example.test/device","userCode":"SYNTHETIC","authorizationUrl":"https://example.test/claude","codeSubmitted":true}"""
    @Test fun catalogAndRawCreateUseExactPayloadAndIgnoreDefaults() = runTest {
        assertTrue(api.catalog().single().selectable)
        status = 201; response = runtime
        assertEquals("saved-id", api.create("codex", " Saved ").id)
        assertEquals("""{"provider":"codex","label":"Saved"}""", payload())
        api.create("claude-code", null); assertEquals("""{"provider":"claude-code"}""", payload())
        assertEquals("/teams/507f1f77bcf86cd799439011/agent-runtimes", requests.last().url.encodedPath)
    }
    @Test fun exactLoginCodeAndCancelBodiesAndStates() = runTest {
        status = 202; response = login(); val attempt = api.start("saved-id")
        assertEquals(attemptId, attempt.attemptId); assertEquals(0, payload().length)
        status = 200; api.code("saved-id", attemptId, " code#state ")
        assertEquals("""{"attemptId":"$attemptId","code":"code#state"}""", payload())
        assertTrue(requests.last().url.encodedPath.endsWith("/saved-id/login/code"))
        response = login("connected"); val connected = api.login("saved-id")
        assertNull(connected.userCode); assertNull(connected.authorizationUrl); assertNull(connected.verificationUri)
        status = 204; response = ""; api.cancel("saved-id", attemptId)
        assertEquals("DELETE", requests.last().method); assertEquals("""{"attemptId":"$attemptId"}""", payload())
    }
    @Test fun exact404AbsenceDiffersFromOther404And403DoesNotExpire() = runTest {
        status = 404; response = """{"error":{"code":"runtime_login_not_found"}}"""
        try { api.login("saved-id"); fail() } catch (_: RuntimeLoginAbsent) { }
        response = """{"error":{"code":"runtime_not_found"}}"""
        try { api.login("saved-id"); fail() } catch (e: RuntimeHttpFailure) { assertEquals("runtime_not_found", e.errorCode) }
        status = 403
        try { api.start("saved-id"); fail() } catch (e: RuntimeHttpFailure) { assertEquals(403, e.status) }
        status = 401
        try { api.catalog(); fail() } catch (_: NuphosApi.Failure.Unauthorized) { }
    }
    @Test fun malformedResponsesAndUnexpectedSuccessStatusAreRejected() = runTest {
        response = "{}"; try { api.catalog(); fail() } catch (_: NuphosApi.Failure.InvalidResponse) { }
        status = 200; response = runtime; try { api.create("codex", null); fail() } catch (_: NuphosApi.Failure.InvalidResponse) { }
        response = login("invented"); try { api.login("saved-id"); fail() } catch (_: NuphosApi.Failure.InvalidResponse) { }
        response = login().replace(attemptId, "bad"); try { api.login("saved-id"); fail() } catch (_: NuphosApi.Failure.InvalidResponse) { }
    }
    @Test fun codeAndIdentityValidationMakeNoRequestAndBrowserIsHttpsOnly() = runTest {
        for (code in listOf("code", "c#s#extra", "非ascii#state", "a".repeat(2049) + "#s")) {
            try { api.code("saved-id", attemptId, code); fail() } catch (_: IllegalArgumentException) { }
        }
        try { api.start("../other"); fail() } catch (_: IllegalArgumentException) { }
        try { api.create("unknown", null); fail() } catch (_: IllegalArgumentException) { }
        try { api.create("codex", " "); fail() } catch (_: IllegalArgumentException) { }
        assertTrue(requests.isEmpty())
        for (url in listOf("http://example.test", "https://user:pass@example.test", "javascript:alert(1)", "https:///bad")) assertFalse(runtimeHttpsUrl(url))
        assertTrue(runtimeHttpsUrl("https://example.test/auth?state=synthetic"))
    }
}
