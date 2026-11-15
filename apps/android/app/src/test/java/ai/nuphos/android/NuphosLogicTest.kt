package ai.nuphos.android

import ai.nuphos.android.data.NuphosWeb
import ai.nuphos.android.model.HistoryTime
import ai.nuphos.android.model.PlanLink
import ai.nuphos.android.ui.components.MarkdownStreamUpdate
import ai.nuphos.android.ui.components.bareUrlEnd
import ai.nuphos.android.ui.components.markdownStreamUpdate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import okhttp3.ResponseBody.Companion.toResponseBody

class NuphosLogicTest {
    @Test
    fun loginUrlOpensTheChosenProviderWithOnlyTheOpaqueHandle() {
        val handle = "h".repeat(43)
        val base = ai.nuphos.android.data.NuphosApi.BASE_URL
        assertEquals("$base/auth/social/google/start?handle=$handle", NuphosWeb.loginUrl(handle, NuphosWeb.Provider.Google))
        assertEquals("$base/auth/social/apple/start?handle=$handle", NuphosWeb.loginUrl(handle, NuphosWeb.Provider.Apple))
        try { NuphosWeb.loginUrl("a+b&c", NuphosWeb.Provider.Google); org.junit.Assert.fail() } catch (_: IllegalArgumentException) { }
    }

    @Test
    fun providerHeaderMatchesIosOrderAndFallback() {
        assertEquals(listOf(NuphosWeb.Provider.Apple, NuphosWeb.Provider.Google), NuphosWeb.providers("google,apple"))
        assertEquals(listOf(NuphosWeb.Provider.Google), NuphosWeb.providers(" google,unknown,google "))
        assertEquals(emptyList<NuphosWeb.Provider>(), NuphosWeb.providers(""))
        assertEquals(listOf(NuphosWeb.Provider.Google), NuphosWeb.providers(null))
    }

    @Test
    fun providerDiscoveryTreats503AsNoneAndOtherFailuresAsRetryable() {
        fun client(code: Int, header: String?) = okhttp3.OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            assertEquals("GET", request.method)
            assertEquals("/auth/social/login", request.url.encodedPath)
            assertNull(request.header("Authorization"))
            okhttp3.Response.Builder().request(request).protocol(okhttp3.Protocol.HTTP_1_1).code(code).message("fixture")
                .apply { if (header != null) header("X-Nuphos-Social-Providers", header) }
                .body("".toResponseBody()).build()
        }.build()
        assertEquals(listOf(NuphosWeb.Provider.Apple, NuphosWeb.Provider.Google), NuphosWeb.availableProviders(client(200, "google,apple")))
        assertEquals(listOf(NuphosWeb.Provider.Google), NuphosWeb.availableProviders(client(200, null)))
        assertEquals(emptyList<NuphosWeb.Provider>(), NuphosWeb.availableProviders(client(503, "google")))
        for (code in listOf(500, 404, 401)) {
            try { NuphosWeb.availableProviders(client(code, "google")); org.junit.Assert.fail() } catch (_: java.io.IOException) { }
        }
    }

    @Test
    fun externalAccountTokenCannotBecomeLoginDelivery() {
        assertNull(NuphosWeb.parseDelivery("nuphos://google-callback?token=abc123", "pending"))
        assertNull(NuphosWeb.parseDelivery("/callback?state=pending&token=abc123", "pending"))
    }

    @Test
    fun deliveryAcceptsBoundCodeAndProviderFailure() {
        val code = "c".repeat(43)
        assertEquals(NuphosWeb.CallbackResult.Code(code), NuphosWeb.parseDelivery("/callback?state=pending&code=$code", "pending"))
        assertTrue(NuphosWeb.parseDelivery("/callback?state=pending&error=denied", "pending") is NuphosWeb.CallbackResult.Failure)
    }

    @Test
    fun deliveryRejectsAmbiguousAndMalformedCallbacks() {
        val code = "c".repeat(43)
        for (target in listOf(
            "/callback?state=other&code=$code", "/callback?code=$code",
            "/callback?state=pending&state=pending&code=$code",
            "/callback?state=pending&code=$code&code=$code",
            "/callback?state=pending&code=$code&error=denied",
            "/callback?state=pending&code=%ZZ", "/callback/extra?state=pending&code=$code",
            "//evil/callback?state=pending&code=$code", "/callback?state=pending&code=$code#fragment",
            "/callback?state=pending&%73tate=pending&code=$code",
            "/%63allback?state=pending&code=$code",
        )) assertNull(target, NuphosWeb.parseDelivery(target, "pending"))
    }

    @Test
    fun historyTimeNow() {
        val now = Instant.parse("2026-08-26T12:00:00Z")
        assertEquals("now", HistoryTime.format(now, now))
    }

    @Test
    fun historyTimeMinutes() {
        val now = Instant.parse("2026-08-26T12:00:00Z")
        val then = now.minusSeconds(5 * 60)
        assertEquals("5 min", HistoryTime.format(then, now))
    }

    @Test
    fun planLinkParsesTeamAndPlan() {
        val target = PlanLink.target("https://nuphos.ai/teams/teamA/plans/planB")
        assertEquals("teamA", target?.teamId)
        assertEquals("planB", target?.planId)
    }

    @Test
    fun markdownStreamAppendsOnlyTheDelta() {
        assertEquals(MarkdownStreamUpdate.None, markdownStreamUpdate("Hello", "Hello"))
        assertEquals(MarkdownStreamUpdate.Append(" world"), markdownStreamUpdate("Hello", "Hello world"))
        assertEquals(MarkdownStreamUpdate.Restart, markdownStreamUpdate("Hello world", "Hi"))
    }

    @Test
    fun bareUrlEndsBeforeFullWidthPunctuation() {
        val pr = "https://github.com/nuphos/nuphos/pull/2595"
        for (tail in listOf("（Fixes", "，下一句", "。", "、b", "：", "「x」", "\u3000next")) {
            assertEquals(tail, pr.length, bareUrlEnd(pr + tail))
        }
        for (url in listOf(pr, "https://zh.wikipedia.org/wiki/台灣", "https://example.com/a?b=c,d")) {
            assertEquals(url, url.length, bareUrlEnd(url))
        }
    }
}
