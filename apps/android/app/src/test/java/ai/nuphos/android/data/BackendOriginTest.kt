package ai.nuphos.android.data

import org.junit.Assert.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Test

class BackendOriginTest {
    @After fun reset() { BackendOrigin.select(BackendOrigin.DEFAULT) }

    @Test fun normalizesHttpsOriginsAndPorts() {
        assertEquals("https://example.com", BackendOrigin.normalize(" https://EXAMPLE.com/ "))
        assertEquals("https://example.com:8443", BackendOrigin.normalize("https://example.com:8443"))
        assertEquals("https://[::1]:8443", BackendOrigin.normalize("https://[::1]:8443/"))
    }

    @Test fun refusesAmbiguousOrInsecureAddresses() {
        listOf("http://example.com", "example.com", "https://user:password@example.com",
            "https://example.com/api", "https://example.com/?token=x", "https://example.com/#x",
            "https://example.com:0", "https://example.com:65536", "https://example.com/../",
            "https://example.com\\@evil.example").forEach {
            assertThrows("Accepted $it", IllegalArgumentException::class.java) { BackendOrigin.normalize(it) }
        }
    }

    @Test fun credentialsStayOnTheirIssuingServerAfterSelectionChanges() {
        BackendOrigin.bind("origin-fixture", "https://first.example:8443")
        BackendOrigin.select("https://second.example")
        assertEquals("https://first.example:8443", BackendOrigin.forToken("origin-fixture"))
        assertFalse(BackendOrigin.accepts("origin-fixture", "https://first.example/auth/me"))
        assertFalse(BackendOrigin.accepts("origin-fixture", "https://second.example/auth/me"))
        assertTrue(BackendOrigin.accepts("origin-fixture", "https://first.example:8443/auth/me"))
        assertFalse(BackendOrigin.accepts("unknown-fixture", "https://second.example/auth/me"))
    }

    @Test fun authenticatedRequestsUseTheTokenOriginWhileLoginUsesTheSelectedServer() = kotlinx.coroutines.runBlocking {
        BackendOrigin.select("https://first-auth.example:8443")
        BackendOrigin.bind("self-hosted-fixture")
        val requests = mutableListOf<okhttp3.Request>()
        val client = okhttp3.OkHttpClient.Builder().addInterceptor { chain ->
            requests.add(chain.request())
            okhttp3.Response.Builder().request(chain.request()).protocol(okhttp3.Protocol.HTTP_1_1)
                .code(200).message("fixture")
                .body("""{"ok":true}""".toResponseBody()).build()
        }.build()
        val login = AccountApi("", client)
        BackendOrigin.select("https://second-auth.example")
        login.requestSignInCode("someone@example.com")
        AccountApi("self-hosted-fixture", client).endSession()
        assertEquals("first-auth.example", requests[0].url.host)
        assertNull(requests[0].header("Authorization"))
        assertEquals("first-auth.example", requests[1].url.host)
        assertEquals(8443, requests[1].url.port)
        assertEquals("https://first-auth.example:8443", NuphosApi.baseUrl("self-hosted-fixture"))
        assertEquals("https://second-auth.example/auth/social/google/start?handle=${"h".repeat(43)}",
            NuphosWeb.loginUrl("h".repeat(43), NuphosWeb.Provider.Google))
    }

    @Test fun originGuardAllowsOnlyTheBoundServerWithoutChangingConsentRequirements() {
        BackendOrigin.bind("guard-fixture", "https://guard.example:9443")
        var calls = 0
        val client = okhttp3.OkHttpClient.Builder().addInterceptor(ConsentInterceptor()).addInterceptor { chain ->
            calls++
            okhttp3.Response.Builder().request(chain.request()).protocol(okhttp3.Protocol.HTTP_1_1)
                .code(200).message("fixture").body("""{"ok":true}""".toResponseBody()).build()
        }.build()
        fun request(url: String) = okhttp3.Request.Builder().url(url).header("Authorization", "Bearer guard-fixture").build()
        client.newCall(request("https://guard.example:9443/auth/me")).execute().close()
        assertThrows(java.io.IOException::class.java) { client.newCall(request("https://guard.example:9443/teams")).execute() }
        assertThrows(java.io.IOException::class.java) { client.newCall(request("https://api.nuphos.ai/auth/me")).execute() }
        assertEquals(1, calls)
        assertFalse(Http.client.followRedirects)
        assertFalse(Http.client.followSslRedirects)
    }

    @Test fun legacyTokensRestoreOnlyOnCloudAndSavedTokensOnlyOnTheirServer() {
        BackendOrigin.select(BackendOrigin.DEFAULT)
        assertEquals("legacy-fixture", BackendOrigin.restore("legacy-fixture", null))
        BackendOrigin.select("https://restore.example")
        assertNull(BackendOrigin.restore("legacy-fixture", null))
        assertNull(BackendOrigin.restore("other-fixture", "https://other.example"))
        assertEquals("restore-fixture", BackendOrigin.restore("restore-fixture", "https://restore.example"))
        assertEquals("https://restore.example", BackendOrigin.forToken("restore-fixture"))
    }

    @Test fun sharedLinksAndAvatarsStayOnTheSelectedBackend() {
        BackendOrigin.select("https://links.example:8443")
        val team = "a".repeat(24)
        val own = "https://links.example:8443/teams/$team/agent/session"
        assertEquals(own, ConversationActions.shareUrl(team, "session"))
        assertNotNull(ai.nuphos.android.session.ConversationLink.parse(own))
        assertNull(ai.nuphos.android.session.ConversationLink.parse("https://nuphos.ai/teams/$team/agent/session"))
        assertNotNull(ai.nuphos.android.model.PlanLink.target("https://links.example:8443/teams/$team/plans/plan"))
        assertNull(ai.nuphos.android.model.PlanLink.target("https://nuphos.ai/teams/$team/plans/plan"))
        val avatar = "https://links.example:8443/avatars/${"a".repeat(24)}/${"b".repeat(64)}.webp"
        assertEquals(avatar, ai.nuphos.android.model.SenderAvatar.trusted(avatar))
        assertFalse(BackendOrigin.supportsCloudPush())
    }
}
