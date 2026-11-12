package ai.nuphos.android.data

import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import kotlin.concurrent.thread

class TwoFactorApiTest {
    private val requests = mutableListOf<Request>()
    private val replies = ArrayDeque<Pair<Int, String>>()
    private fun client(vararg interceptors: okhttp3.Interceptor) = OkHttpClient.Builder().apply {
        interceptors.forEach { addInterceptor(it) }
        addInterceptor { chain ->
            requests.add(chain.request())
            val (status, body) = replies.removeFirst()
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(status).message("fixture").body(body.toResponseBody(Http.jsonMedia)).build()
        }
    }.build()

    private val mfaRequired = """{"error":{"code":"mfa_required","message":"Enter the code","details":{"mfaToken":"challenge"}}}"""
    private val reauth = """{"error":{"code":"reauth_required","message":"Enter a code","details":{"method":"mfa"}}}"""

    @Test fun aSignInThatNeedsACodeCarriesItsChallenge() = runTest {
        replies += 401 to mfaRequired
        try { AccountApi("", client()).emailSignIn("a@example.com", "123456"); fail() }
        catch (e: NuphosApi.Failure.MfaRequired) { assertEquals("challenge", e.challenge) }
    }

    @Test fun aRefusedCodeIsNotASignedOutSession() = runTest {
        replies += 401 to """{"error":{"code":"invalid_mfa_code","message":"That code is not valid"}}"""
        try { AccountApi("", client()).verifyMfa("challenge", "000000"); fail() }
        catch (e: NuphosApi.Failure.Http) { assertEquals("That code is not valid", e.message) }
    }

    @Test fun theChallengeAndACodeStartTheSession() = runTest {
        replies += 200 to """{"token":"session","user":{"id":"u1"}}"""
        assertEquals("session", AccountApi("", client()).verifyMfa("challenge", " 123456 "))
        assertEquals("https://api.nuphos.ai/auth/mfa/verify", requests.single().url.toString())
        assertNull(requests.single().header("Authorization"))
    }

    @Test fun onlyAnMfaReauthAsksForACode() {
        assertTrue(StepUp.needsCode(reauth))
        assertFalse(StepUp.needsCode("""{"error":{"code":"reauth_required","details":{"method":"sign_in"}}}"""))
        assertFalse(StepUp.needsCode("""{"error":{"code":"session_required"}}"""))
        assertFalse(StepUp.needsCode("not json"))
    }

    @Test fun withoutAHostTheRefusalPassesThrough() {
        StepUp.hosted = false
        replies += 403 to reauth
        val response = client(StepUpInterceptor()).newCall(
            Request.Builder().url("https://api.nuphos.ai/teams/t/members/m").header("Authorization", "Bearer x").get().build(),
        ).execute()
        assertEquals(403, response.code)
        assertEquals(1, requests.size)
    }

    @Test fun anAnsweredPromptSendsTheRequestAgain() {
        StepUp.hosted = true
        replies += 403 to reauth
        replies += 200 to "{}"
        // Answer as the dialog would, once the interceptor is waiting.
        val answerer = thread {
            while (StepUp.token == null) Thread.sleep(5)
            assertEquals("x", StepUp.token)
            StepUp.finish(true)
        }
        val response = client(StepUpInterceptor()).newCall(
            Request.Builder().url("https://api.nuphos.ai/teams/t/members/m").header("Authorization", "Bearer x").get().build(),
        ).execute()
        answerer.join()
        assertEquals(200, response.code)
        assertEquals(2, requests.size)
        StepUp.hosted = false
    }
}
