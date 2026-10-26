package ai.nuphos.android

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.model.SignInSession
import ai.nuphos.android.model.SignInSessions
import ai.nuphos.android.ui.profile.DevicesLoad
import ai.nuphos.android.ui.profile.SignedInDevicesContent
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.time.Instant

/** Synthetic sessions only (RFC 5737 addresses); no account or network. */
@RunWith(AndroidJUnit4::class)
class SignedInDevicesFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val now = Instant.parse("2026-10-26T12:00:00Z")
    private val sessions = SignInSessions.sorted(listOf(
        SignInSession("6a0000000000000000000002", lastUsedAt = "2026-10-26T10:00:00Z", city = "Taipei", country = "TW", ip = "198.51.100.7", client = "nuphos-desktop/0.95.0"),
        SignInSession("6a0000000000000000000003", lastUsedAt = "2026-10-23T08:00:00Z", city = "Tokyo", country = "JP", ip = "192.0.2.44",
            userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"),
        SignInSession("6a0000000000000000000001", current = true, lastUsedAt = "2026-10-26T12:00:00Z", city = "Taipei", country = "TW", ip = "203.0.113.24", client = "nuphos-android/1.4.0"),
        SignInSession("6a0000000000000000000004", lastUsedAt = "2026-10-14T02:00:00Z", city = "Singapore", country = "SG", ip = "203.0.113.80", client = "nuphos-ios/1.6.0"),
        SignInSession("6a0000000000000000000005", lastUsedAt = "2026-08-20T02:00:00Z", ip = "192.0.2.10", userAgent = "node"),
        // A claimed version is never shown, so this reads "Nuphos Desktop".
        SignInSession("6a0000000000000000000007", lastUsedAt = "2026-10-25T02:00:00Z", city = "Amsterdam", country = "NL", ip = "192.0.2.77", client = "nuphos-desktop/1.verify-at.evil-phish.com"),
        // A made-up client name is never shown.
        SignInSession("6a0000000000000000000006", lastUsedAt = "2026-07-01T02:00:00Z", country = "US", ip = "198.51.100.150", client = "Nuphos Security: call +1 555 0100"),
    ))
    private val calls = mutableListOf<String>()

    private fun render(load: DevicesLoad) {
        compose.setContent {
            NuphosTheme(darkTheme = false) {
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.systemBarsPadding().padding(top = 16.dp)) {
                        SignedInDevicesContent(
                            load = load, busy = false, notice = null, now = now,
                            onSignOut = { calls += it?.id ?: "others" },
                            onSignInAgain = { calls += "signInAgain" },
                            onRetry = { calls += "retry" },
                        )
                    }
                }
            }
        }
    }

    @Test fun listsThisDeviceFirstAndAsksBeforeSigningOut() {
        render(DevicesLoad.Ready(sessions))
        compose.onNodeWithText("This device").assertIsDisplayed()
        compose.onNodeWithText("Nuphos for Android").assertIsDisplayed()
        compose.onNodeWithText("Taipei, TW · 203.0.113.24 · Active now").assertIsDisplayed()
        compose.onNodeWithText("Chrome on macOS").assertIsDisplayed()
        compose.onNodeWithText("Web sign-in (nuphos.ai)").assertIsDisplayed()
        compose.onNodeWithText("Nuphos Security", substring = true).assertDoesNotExist()
        compose.onNodeWithText("evil-phish", substring = true).assertDoesNotExist()
        compose.onNodeWithText("0.95.0", substring = true).assertDoesNotExist()
        compose.onAllNodesWithText("Sign out").assertCountEquals(sessions.size - 1)
        capture("list")

        compose.onAllNodesWithText("Sign out")[0].performClick()
        compose.onNodeWithText("Sign out Nuphos Desktop?").assertIsDisplayed()
        capture("confirm")
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(emptyList<String>(), calls)

        compose.onNodeWithText("Sign out all other devices").performScrollTo().performClick()
        compose.onNodeWithText("Sign out all other devices?").assertIsDisplayed()
        compose.onAllNodesWithText("Sign out").filterToOne(hasAnyAncestor(isDialog())).performClick()
        assertEquals(listOf("others"), calls)
    }

    @Test fun signInFromBeforeSessionsAsksToSignInAgain() {
        render(DevicesLoad.SignInAgain)
        compose.onNodeWithText("Sign in again to manage your devices.").assertIsDisplayed()
        compose.onNodeWithText("Couldn’t load", substring = true).assertDoesNotExist()
        capture("legacy")
        compose.onNodeWithText("Sign out and sign in again").performClick()
        assertEquals(listOf("signInAgain"), calls)
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        // Dialog windows animate outside Compose's clock; let them and any ripple settle.
        Thread.sleep(1500)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        val dir = java.io.File(instrumentation.targetContext.getExternalFilesDir(null), "signed-in-devices-evidence").apply { mkdirs() }
        java.io.File(dir, "$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
}
