package ai.nuphos.android.data

import ai.nuphos.android.session.AiAccess
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.Protocol
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.After
import org.junit.Test

class ConsentInterceptorTest {
    @After fun clean() { AiAccess.revoke() }

    @Test fun accountWorksWithoutConsentButAgentMakesNoTransportCall() {
        AiAccess.activate("fixture")
        var calls = 0
        val client = OkHttpClient.Builder().addInterceptor(ConsentInterceptor()).addInterceptor { chain ->
            calls++
            assertNull(chain.request().header("x-nuphos-ai-consent-version"))
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body("{}".toResponseBody()).build()
        }.build()
        client.newCall(request("auth/me")).execute().close()
        assertEquals(1, calls)
        assertThrows(java.io.IOException::class.java) { client.newCall(request("agent/conversations")).execute() }
        assertEquals(1, calls)
    }

    @Test fun acceptedRequestsHaveNoticeAndServerRevocationClosesAccess() {
        AiAccess.activate("fixture")
        AiAccess.grant("fixture")
        val client = OkHttpClient.Builder().addInterceptor(ConsentInterceptor()).addInterceptor { chain ->
            assertEquals(AccountApi.AI_CONSENT_VERSION, chain.request().header("x-nuphos-ai-consent-version"))
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(403).message("fixture")
                .body("""{"error":"ai_consent_required"}""".toResponseBody()).build()
        }.build()
        client.newCall(request("teams")).execute().close()
        assertFalse(AiAccess.allows("fixture"))
    }

    @Test fun unrelatedForbiddenDoesNotWithdrawConsentAndCredentialsNeverGoExternal() {
        AiAccess.activate("fixture")
        AiAccess.grant("fixture")
        var calls = 0
        val client = OkHttpClient.Builder().addInterceptor(ConsentInterceptor()).addInterceptor { chain ->
            calls++
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(403).message("fixture")
                .body("""{"error":{"code":"forbidden"}}""".toResponseBody()).build()
        }.build()
        client.newCall(request("teams")).execute().close()
        assertTrue(AiAccess.allows("fixture"))
        assertThrows(java.io.IOException::class.java) {
            client.newCall(request("teams").newBuilder().url("https://example.invalid/teams").build()).execute()
        }
        assertEquals(1, calls)
    }

    @Test fun oldForbiddenResponseCannotRevokeAnotherAccount() {
        AiAccess.activate("fixture")
        AiAccess.grant("fixture")
        val client = OkHttpClient.Builder().addInterceptor(ConsentInterceptor()).addInterceptor { chain ->
            AiAccess.activate("new-account")
            AiAccess.grant("new-account")
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(403).message("fixture")
                .body("""{"error":{"code":"ai_consent_required"}}""".toResponseBody()).build()
        }.build()
        client.newCall(request("teams")).execute().close()
        assertTrue("An old account response revoked the current account", AiAccess.allows("new-account"))
    }

    private fun request(path: String) = Request.Builder().url("${NuphosApi.BASE_URL}/$path")
        .header("Authorization", "Bearer fixture").build()
}
