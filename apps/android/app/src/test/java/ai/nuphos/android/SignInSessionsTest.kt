package ai.nuphos.android

import ai.nuphos.android.model.SignInSession
import ai.nuphos.android.model.SignInSessions
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

/** Same cases as Desktop's signInSessionsPresentation.test.ts. */
class SignInSessionsTest {
    private fun device(client: String?, userAgent: String?) = SignInSessions.device(SignInSession("s", client = client, userAgent = userAgent))

    @Test fun anAppThatNamesItselfIsShownByNameOnly() {
        assertEquals("Nuphos Desktop", device("nuphos-desktop/1.2.0", "node"))
        assertEquals("Nuphos for Android", device("nuphos-android/1.4.0", null))
        assertEquals("Nuphos for iOS", device("nuphos-ios/2.1.0", null))
        assertEquals("Nuphos CLI", device("nuphos-cli/0.9.0-beta.1", null))
        // The version is whatever the client claims, so it is never shown.
        assertEquals("Nuphos Desktop", device("nuphos-desktop/1.verify-at.evil-phish.com", null))
        // Anything else the client sent is never echoed.
        assertEquals("Unknown device", device("Nuphos Security: reply with this code", null))
        assertEquals("Unknown device", device("nuphos-web/1.0", null))
        assertEquals("Unknown device", device("evil-phish.com/nuphos-desktop", null))
    }

    @Test fun withoutAnAppNameTheUserAgentGivesARoughGuess() {
        assertEquals("Web sign-in (nuphos.ai)", device(null, "node"))
        assertEquals("Web sign-in (nuphos.ai)", device(null, "undici/6.0"))
        assertEquals("Chrome on macOS", device(null, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36"))
        assertEquals("Edge on Windows", device(null, "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0"))
        assertEquals("Safari on iOS", device(null, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Safari/604.1"))
        assertEquals("Firefox on Linux", device(null, "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"))
        assertEquals("Unknown device", device(null, "anything at all"))
        assertEquals("Unknown device", device(null, null))
    }

    @Test fun placeJoinsCityCountryAndIpWhateverIsKnown() {
        assertEquals("Taipei, TW · 203.0.113.9", SignInSessions.place(SignInSession("s", city = "Taipei", country = "TW", ip = "203.0.113.9")))
        assertEquals("Unknown location · 203.0.113.9", SignInSessions.place(SignInSession("s", ip = "203.0.113.9")))
        assertEquals("Unknown location", SignInSessions.place(SignInSession("s")))
    }

    @Test fun activitySaysActiveNowForThisDeviceAndAgeForOthers() {
        val now = Instant.parse("2026-10-26T12:00:00Z")
        assertEquals("Active now", SignInSessions.activity(SignInSession("s", current = true, lastUsedAt = "2026-10-01T00:00:00Z"), now))
        assertEquals("Last active 3 hrs ago", SignInSessions.activity(SignInSession("s", lastUsedAt = "2026-10-26T09:00:00Z"), now))
        assertEquals("Last active just now", SignInSessions.activity(SignInSession("s", lastUsedAt = "2026-10-26T11:59:30Z"), now))
        assertEquals(null, SignInSessions.activity(SignInSession("s"), now))
    }

    @Test fun thisDeviceComesFirstThenTheMostRecentlyActive() {
        fun s(id: String, lastUsedAt: String?, current: Boolean? = null) = SignInSession(id, current = current, lastUsedAt = lastUsedAt)
        assertEquals(
            listOf("here", "new", "old", "never"),
            SignInSessions.sorted(listOf(s("old", "2026-10-01T00:00:00Z"), s("never", null), s("here", "2026-09-01T00:00:00Z", true), s("new", "2026-10-20T00:00:00Z"))).map { it.id },
        )
    }
}
