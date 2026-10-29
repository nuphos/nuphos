package ai.nuphos.android

import android.content.ComponentName
import android.content.pm.PackageManager
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.ui.profile.ProfileContent
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ProfileLayoutDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val calls = mutableListOf<String>()
    private fun render(busy: Boolean = false, allowed: Boolean = true) {
        compose.setContent {
            NuphosTheme(darkTheme = InstrumentationRegistry.getArguments().getString("fixtureDark") == "true") {
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.systemBarsPadding()) {
                        Text("SYNTHETIC PROFILE · no account / network", style = MaterialTheme.typography.labelSmall)
                        ProfileContent(
                            user = NuphosUser("synthetic-profile", "long.synthetic.account@example.invalid", "Synthetic Profile", "synthetic_profile"),
                            canWithdraw = allowed, consentBusy = busy, consentError = null,
                            onEdit = { calls += "edit" }, onDevices = { calls += "devices" }, onPrivacy = { calls += "privacy" },
                            onWithdraw = { calls += "withdraw" }, onDeletion = { calls += "delete" },
                            onSignOut = { calls += "signout" },
                            voiceSettings = {
                                Text("Voice input", style = MaterialTheme.typography.titleSmall)
                                Text("Synthetic settings · no stored key")
                                OutlinedTextField("Synthetic transcription prompt", {}, label = { Text("Transcription prompt") }, modifier = Modifier.fillMaxWidth())
                                Text("Recordings are sent to OpenAI and billed to your OpenAI account.")
                            },
                        )
                    }
                }
            }
        }
    }
    @Test fun settingsAreLeftAlignedAndAllActionsRemainReachable() {
        render()
        capture("profile-top")
        val edit = compose.onNodeWithText("Edit profile")
        edit.assertIsDisplayed()
        val label = edit.fetchSemanticsNode().boundsInRoot
        val header = compose.onNodeWithText("Synthetic Profile").fetchSemanticsNode().boundsInRoot
        assertTrue("Settings must start left of the centered identity", label.left < header.left)
        edit.performClick()
        compose.onNodeWithText("Technical details").performClick()
        compose.onNodeWithText("synthetic-profile").assertExists()
        for ((labelText, call) in listOf("Signed-in devices" to "devices", "Privacy policy" to "privacy", "Withdraw AI sharing consent" to "withdraw", "Account deletion request" to "delete", "Sign out" to "signout")) {
            compose.onNodeWithText(labelText).performScrollTo().assertIsDisplayed().performClick()
            assertTrue(calls.contains(call))
        }
        assertEquals(listOf("edit", "devices", "privacy", "withdraw", "delete", "signout"), calls)
        capture("profile-bottom")
    }
    @Test fun appIconPickerSwitchesTheLauncherEntry() {
        render()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        fun state(id: String) = context.packageManager.getComponentEnabledSetting(ComponentName(context, "ai.nuphos.android.Icon$id"))
        compose.onNodeWithContentDescription("Son of Man, Peek").performScrollTo()
        compose.onNodeWithContentDescription("Napoleon, Bleed").assertIsSelected()
        capture("app-icon")
        compose.onNodeWithContentDescription("Nuphos").performClick()
        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_ENABLED, state("A"))
        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DISABLED, state("B2"))
        compose.onNodeWithContentDescription("Napoleon, Bleed").performClick()
        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_ENABLED, state("B2"))
        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DISABLED, state("A"))
    }
    @Test fun busyConsentCannotInvokeWithdrawal() {
        render(busy = true)
        compose.onNodeWithText("Withdraw AI sharing consent").performScrollTo().assertIsNotEnabled()
        assertTrue(calls.isEmpty())
    }
    @Test fun absentConsentHidesWithdrawalWithoutHidingOtherActions() {
        render(allowed = false)
        compose.onNodeWithText("Withdraw AI sharing consent").assertDoesNotExist()
        compose.onNodeWithText("Sign out").performScrollTo().assertIsDisplayed()
    }
    private fun capture(name: String) {
        compose.mainClock.advanceTimeBy(1500)
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        val dir = java.io.File(instrumentation.targetContext.getExternalFilesDir(null), "profile-evidence").apply { mkdirs() }
        java.io.File(dir, "$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
}
