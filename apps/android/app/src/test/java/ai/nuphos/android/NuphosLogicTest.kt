package ai.nuphos.android

import ai.nuphos.android.data.NuphosWeb
import ai.nuphos.android.model.HistoryTime
import ai.nuphos.android.model.PlanLink
import ai.nuphos.android.ui.components.MarkdownStreamUpdate
import ai.nuphos.android.ui.components.markdownStreamUpdate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class NuphosLogicTest {
    @Test
    fun loginUrlCarriesOnlyOpaqueHandle() {
        val handle = "h".repeat(43)
        assertEquals("https://nuphos.ai/api/google/start?handle=$handle", NuphosWeb.loginUrl(handle))
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
}
