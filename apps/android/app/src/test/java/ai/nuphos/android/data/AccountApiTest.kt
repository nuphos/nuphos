package ai.nuphos.android.data

import ai.nuphos.android.model.*
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

class AccountApiTest {
    private val requests = mutableListOf<okhttp3.Request>()
    private var response = """{"version":"2026-09-28","accepted":false}"""
    private var status = 200
    private val api = AccountApi("fixture-token", OkHttpClient.Builder().addInterceptor { chain ->
        requests.add(chain.request())
        Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
            .code(status).message("fixture").body(response.toResponseBody(Http.jsonMedia)).build()
    }.build())
    private fun body() = Buffer().also { requests.last().body!!.writeTo(it) }.readUtf8()

    @Test fun consentHasFixedHostAndAccountHeadersWithoutAiGate() = runTest {
        assertFalse(api.consent().accepted)
        api.setConsent(true)
        assertEquals("PUT", requests.last().method)
        assertEquals("https://api.nuphos.ai/auth/ai-consent", requests.last().url.toString())
        assertEquals("""{"version":"2026-09-28","accepted":true}""", body())
        api.setConsent(false)
        assertEquals("""{"version":"2026-09-28","accepted":false}""", body())
        requests.forEach {
            assertEquals("Bearer fixture-token", it.header("Authorization"))
            assertNotNull(it.header("x-atlas-client"))
            assertNull(it.header("x-nuphos-ai-consent-version"))
        }
    }
    @Test fun profileTrimsOnlyNameAndUsernameAndKeepsConflict() = runTest {
        response = """{"error":{"message":"Username is already in use"}}"""; status = 409
        try { api.updateProfile(" Name ", " user_1 ", ""); fail() }
        catch (e: NuphosApi.Failure.Http) { assertEquals(409, e.code) }
        assertEquals("PATCH", requests.last().method)
        assertEquals("/auth/me", requests.last().url.encodedPath)
        assertEquals("""{"name":"Name","username":"user_1","avatarURL":""}""", body())
    }
    @Test fun profileSuccessReturnsCurrentUser() = runTest {
        response = """{"id":"fixture-user","email":"fixture@example.com","name":"Updated","username":"updated","avatarURL":""}"""
        assertEquals("Updated", api.updateProfile("Updated", "updated", "").name)
    }
    @Test fun deletionReceiptKeepsUnknownStatusAndOriginalDates() = runTest {
        response = """{"request":{"status":"future_status","requestedAt":"2026-10-01T00:00:00Z","dueAt":"2026-10-31T00:00:00Z"}}"""
        val receipt = api.deletion().request!!
        assertEquals("future_status", receipt.status)
        status = 202
        assertEquals(receipt, api.requestDeletion("DELETE", code = "123456").request)
        assertEquals("""{"confirmation":"DELETE","code":"123456"}""", body())
        api.requestDeletion("DELETE", password = "long-password")
        assertEquals("""{"confirmation":"DELETE","password":"long-password"}""", body())
    }
    @Test fun emailRequestHasNoBearerOrAiHeader() = runTest {
        response = """{"ok":true}"""
        api.requestCode("fixture@example.com")
        assertEquals("/auth/email/request-code", requests.last().url.encodedPath)
        assertNull(requests.last().header("Authorization"))
        assertNull(requests.last().header("x-nuphos-ai-consent-version"))
        assertEquals("""{"email":"fixture@example.com"}""", body())
    }
    @Test fun invalidInputMakesZeroRequests() = runTest {
        try { api.updateProfile("", "ok", ""); fail() } catch (_: IllegalArgumentException) { }
        try { api.requestDeletion("DELETE", password = "long-password", code = "123456"); fail() } catch (_: IllegalArgumentException) { }
        assertTrue(requests.isEmpty())
    }
    @Test fun responseFailuresDoNotInventConsentOrMissingReceipt() = runTest {
        for (malformed in listOf("{}", "{\"accepted\":true}", "{\"version\":\"x\",\"accepted\":\"true\"}")) {
            response = malformed
            try { api.consent(); fail() } catch (_: NuphosApi.Failure.InvalidResponse) { }
        }
        response = "{}"
        try { api.deletion(); fail() } catch (_: NuphosApi.Failure.InvalidResponse) { }
        response = "{\"request\":null}"
        assertNull(api.deletion().request)
        status = 401
        try { api.deletion(); fail() } catch (_: NuphosApi.Failure.Unauthorized) { }
        status = 403; response = "{\"error\":{\"message\":\"Verify this account\"}}"
        try { api.deletion(); fail() } catch (e: NuphosApi.Failure.Http) { assertEquals(403, e.code) }
    }
    @Test fun profileAndDeletionValidatorsMatchFormBoundaries() {
        assertNull(profileValidationError(" A ", " a-1_ ", "https://lh3.googleusercontent.com/a"))
        assertNull(profileValidationError("A".repeat(100), "u".repeat(40), ""))
        for (url in listOf("http://lh3.googleusercontent.com/a", "https://evil.example/a", "https://lh3.googleusercontent.com:444/a", "https://u@lh3.googleusercontent.com/a", "https://lh3.googleusercontent.com.evil/a"))
            assertNotNull(profileValidationError("A", "u", url))
        assertNotNull(profileValidationError("A".repeat(101), "u", ""))
        assertNotNull(profileValidationError("A", "a b", ""))
        assertNull(deletionValidationError("DELETE", code = "123456"))
        assertNull(deletionValidationError("DELETE", password = "p".repeat(12)))
        assertNotNull(deletionValidationError(" DELETE ", code = "123456"))
        assertNotNull(deletionValidationError("DELETE", code = "12345"))
        assertNotNull(deletionValidationError("DELETE", password = "p".repeat(11)))
        assertNotNull(deletionValidationError("DELETE"))
    }
}
