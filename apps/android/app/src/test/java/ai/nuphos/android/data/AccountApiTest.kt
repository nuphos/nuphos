package ai.nuphos.android.data

import ai.nuphos.android.model.*
import ai.nuphos.android.ui.profile.isSessionRequired
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

    @Test fun passwordLoginUsesIosContractWithoutBearerAndPreservesPassword() = runTest {
        response = """{"token":"fixture-session"}"""
        assertEquals("fixture-session", api.passwordSignIn(" fixture@example.com ", " password with spaces "))
        assertEquals("POST", requests.last().method)
        assertEquals("https://api.nuphos.ai/auth/password/sign-in", requests.last().url.toString())
        assertNull(requests.last().header("Authorization"))
        assertEquals("""{"email":"fixture@example.com","password":" password with spaces "}""", body())
    }
    @Test fun passwordLoginRejectsInvalidTokenAndUnauthorized() = runTest {
        for (value in listOf("{}", "{\"token\":3}", "{\"token\":\" \"}")) {
            response = value
            try { api.passwordSignIn("fixture@example.com", "fixture-password"); fail() }
            catch (_: NuphosApi.Failure.InvalidResponse) { }
        }
        status = 401
        try { api.passwordSignIn("fixture@example.com", "fixture-password"); fail() }
        catch (_: NuphosApi.Failure.Unauthorized) { }
    }
    @Test fun passwordLoginPreservesRateLimitInstructions() = runTest {
        status = 429
        response = """{"error":{"message":"Too many attempts. Try again in 15 minutes or use an email code"}}"""
        try { api.passwordSignIn("fixture@example.com", "fixture-password"); fail() }
        catch (e: NuphosApi.Failure.Http) {
            assertEquals(429, e.code)
            assertEquals("Too many attempts. Try again in 15 minutes or use an email code", e.message)
        }
        assertEquals(1, requests.size)
    }

    @Test fun passwordLoginInvalidInputDoesNotSendCredentials() = runTest {
        for ((email, password) in listOf("" to "password", "a@b.com" to "", "a@b.com" to "p".repeat(129))) {
            try { api.passwordSignIn(email, password); fail() } catch (_: IllegalArgumentException) { }
        }
        assertTrue(requests.isEmpty())
    }

    @Test fun emailSignupAndPasswordResetUseExactIosContracts() = runTest {
        response = """{"ok":true}"""
        api.requestSignInCode(" fixture@example.com ")
        assertEquals("/auth/email/request-code", requests.last().url.encodedPath)
        assertEquals("""{"email":"fixture@example.com"}""", body())
        response = """{"token":"fixture-session"}"""
        assertEquals("fixture-session", api.emailSignIn(" fixture@example.com ", "123456"))
        assertEquals("/auth/email/verify-code", requests.last().url.encodedPath)
        assertEquals("""{"email":"fixture@example.com","code":"123456"}""", body())
        assertEquals("fixture-session", api.emailSignIn("fixture@example.com", "123456", " new password "))
        assertEquals("/auth/password/set", requests.last().url.encodedPath)
        assertEquals("""{"email":"fixture@example.com","code":"123456","password":" new password "}""", body())
        requests.forEach {
            assertNull(it.header("Authorization"))
            assertNull(it.header("x-nuphos-ai-consent-version"))
            assertEquals("POST", it.method)
        }
    }

    @Test fun emailSecretsAreNotSentForInvalidInput() = runTest {
        for (code in listOf("12345", "1234567", "abcdef", "１２３４５６")) {
            try { api.emailSignIn("fixture@example.com", code); fail() } catch (_: IllegalArgumentException) { }
        }
        for (password in listOf("short", "p".repeat(129))) {
            try { api.emailSignIn("fixture@example.com", "123456", password); fail() } catch (_: IllegalArgumentException) { }
        }
        try { api.requestSignInCode(" "); fail() } catch (_: IllegalArgumentException) { }
        assertTrue(requests.isEmpty())
    }

    @Test fun emailRejectsMalformedResponsesAndDoesNotFollowRedirects() = runTest {
        for (value in listOf("{}", "{\"token\":3}", "{\"token\":\" \"}")) {
            response = value
            try { api.emailSignIn("fixture@example.com", "123456"); fail() }
            catch (_: NuphosApi.Failure.InvalidResponse) { }
        }
        for (value in listOf("{}", "{\"ok\":\"true\"}", "{\"ok\":false}")) {
            response = value
            try { api.requestSignInCode("fixture@example.com"); fail() }
            catch (_: NuphosApi.Failure.InvalidResponse) { }
        }
        for (httpStatus in listOf(400, 429, 503, 302)) {
            status = httpStatus; response = "{}"
            try { api.emailSignIn("fixture@example.com", "123456"); fail() }
            catch (e: NuphosApi.Failure.Http) { assertEquals(httpStatus, e.code) }
        }
    }

    @Test fun consentHasFixedHostAndAccountHeadersWithoutAiGate() = runTest {
        assertFalse(api.consent().accepted)
        api.setConsent(true)
        assertEquals("PUT", requests.last().method)
        assertEquals("${NuphosApi.BASE_URL}/auth/ai-consent", requests.last().url.toString())
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
        assertNull(profileValidationError(" A ", " a-1_ "))
        assertNull(profileValidationError("A".repeat(100), "u".repeat(40)))
        assertNotNull(profileValidationError("A".repeat(101), "u"))
        assertNotNull(profileValidationError("A", "a b"))
        assertNull(deletionValidationError("DELETE", code = "123456"))
        assertNull(deletionValidationError("DELETE", password = "p".repeat(12)))
        assertNotNull(deletionValidationError(" DELETE ", code = "123456"))
        assertNotNull(deletionValidationError("DELETE", code = "12345"))
        assertNotNull(deletionValidationError("DELETE", password = "p".repeat(11)))
        assertNotNull(deletionValidationError("DELETE"))
    }

    @Test fun signInSessionsUseTheSessionsEndpoints() = runTest {
        response = """{"sessions":[{"id":"6a0000000000000000000001","current":true,"lastUsedAt":"2026-10-26T00:00:00.000Z","ip":"203.0.113.9","city":null,"country":"TW","client":"nuphos-android/1.4.0","userAgent":null,"extra":1},{"id":"6a0000000000000000000002"}]}"""
        val sessions = api.signInSessions()
        assertEquals(listOf("6a0000000000000000000001", "6a0000000000000000000002"), sessions.map { it.id })
        assertEquals(true, sessions[0].current)
        assertNull(sessions[1].current)
        assertEquals("GET", requests.last().method)
        assertEquals("https://api.nuphos.ai/auth/sessions", requests.last().url.toString())
        assertEquals("Bearer fixture-token", requests.last().header("Authorization"))

        status = 204; response = ""
        api.signOutSession("6a0000000000000000000002")
        assertEquals("DELETE", requests.last().method)
        assertEquals("/auth/sessions/6a0000000000000000000002", requests.last().url.encodedPath)

        status = 200; response = """{"revoked":3}"""
        assertEquals(3, api.signOutOtherSessions())
        assertEquals("DELETE", requests.last().method)
        assertEquals("/auth/sessions", requests.last().url.encodedPath)
    }

    @Test fun signOutSessionOnlySendsASessionId() = runTest {
        for (id in listOf("current", "", "../me", "6a00000000000000000000012")) {
            try { api.signOutSession(id); fail() } catch (_: IllegalArgumentException) { }
        }
        assertTrue(requests.isEmpty())
    }

    @Test fun sessionRequiredIsNotUnauthorized() = runTest {
        status = 403
        response = """{"error":{"code":"session_required","message":"Sign in to manage your sessions"}}"""
        try { api.signInSessions(); fail() }
        catch (e: NuphosApi.Failure.Http) {
            assertEquals(403, e.code)
            assertEquals("session_required", e.errorCode)
            assertTrue(e.isSessionRequired())
        }
        response = """{"error":{"code":"forbidden","message":"No"}}"""
        try { api.signInSessions(); fail() }
        catch (e: NuphosApi.Failure.Http) { assertFalse(e.isSessionRequired()) }
    }
}
