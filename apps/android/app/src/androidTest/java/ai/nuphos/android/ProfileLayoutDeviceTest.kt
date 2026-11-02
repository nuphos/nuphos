package ai.nuphos.android

import android.content.ComponentName
import android.content.pm.PackageManager
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.graphics.asAndroidBitmap
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
    private fun render(busy: Boolean = false, allowed: Boolean = true, large: Boolean = false) {
        compose.setContent {
            NuphosTheme(darkTheme = InstrumentationRegistry.getArguments().getString("fixtureDark") == "true") {
                val currentDensity = LocalDensity.current
                var avatars by remember { mutableStateOf(true) }
                CompositionLocalProvider(LocalDensity provides Density(currentDensity.density, if (large) 2f else currentDensity.fontScale)) {
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.systemBarsPadding()) {
                        Text("SYNTHETIC PROFILE · no account / network", style = MaterialTheme.typography.labelSmall)
                        ProfileContent(
                            user = NuphosUser("synthetic-profile", "long.synthetic.account@example.invalid", "Synthetic Profile", "synthetic_profile"),
                            canWithdraw = allowed, consentBusy = busy, consentError = null,
                            onEdit = { calls += "edit" }, onDevices = { calls += "devices" }, onPrivacy = { calls += "privacy" },
                            onWithdraw = { calls += "withdraw" }, onDeletion = { calls += "delete" },
                            onSignOut = { calls += "signout" },
                            onCopyUserId = { calls += "copy-id" },
                            botAvatarsEnabled = avatars, onBotAvatarsChange = { avatars = it; calls += "avatars:$it" },
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
    }
    @Test fun settingsAreLeftAlignedAndAllActionsRemainReachable() {
        render()
        capture("profile-top")
        val edit = compose.onNodeWithText("Edit profile")
        edit.assertIsDisplayed()
        val label = edit.fetchSemanticsNode().boundsInRoot
        val header = compose.onAllNodesWithText("Synthetic Profile")[0].fetchSemanticsNode().boundsInRoot
        assertTrue("Settings must start left of the centered identity", label.left < header.left)
        edit.performClick()
        compose.onNodeWithText("Technical details").assertDoesNotExist()
        compose.onNodeWithText("synthetic-profile").assertDoesNotExist()
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
    @Test fun accountFieldsRemainReadableWithoutInvokingActions() {
        render()
        for (label in listOf("Name", "Username", "Email")) {
            compose.onNodeWithText(label.uppercase()).performScrollTo().assertIsDisplayed()
        }
        assertTrue(calls.isEmpty())
    }
    @Test fun appearanceToggleChangesStateOnceWithoutAccountActions() {
        render()
        compose.onNodeWithContentDescription("Bot avatars").performScrollTo().assertIsOn().performClick().assertIsOff()
        assertEquals(listOf("avatars:false"), calls)
    }
    @Test fun largeTextKeepsAppearanceAndPrivacyReachable() {
        render(large = true)
        compose.onNodeWithText("EMAIL").performScrollTo().assertIsDisplayed()
        compose.onNodeWithContentDescription("Bot avatars").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Sign out").performScrollTo().assertIsDisplayed()
        assertTrue(calls.isEmpty())
    }
    @Test fun appearancePreferencePersistsInIsolatedPackage() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val appearance = ai.nuphos.android.model.BotAvatarPreferences.get(context)
        val original = appearance.enabled
        try {
            appearance.update(!original)
            assertEquals(!original, appearance.enabled)
            assertEquals(!original, context.getSharedPreferences("appearance", android.content.Context.MODE_PRIVATE).getBoolean("bot_avatars", original))
        } finally { appearance.update(original) }
    }
    @Test fun longPressIdentityCopiesOnlyOnExplicitAction() {
        render()
        assertTrue(calls.isEmpty())
        compose.onAllNodesWithText("Synthetic Profile")[0].performTouchInput { longClick() }
        assertEquals(listOf("copy-id"), calls)
        compose.onNodeWithText("Technical details").assertDoesNotExist()
    }
    @Test fun editFormSavesOnceThenDisablesActions() {
        compose.setContent {
            var busy by remember { mutableStateOf(false) }
            NuphosTheme {
                ai.nuphos.android.ui.profile.EditProfileForm(NuphosUser("fixture", name = "Synthetic", username = "synthetic"), busy, null,
                    onDismiss = { calls += "cancel-edit" }, onChoosePhoto = { calls += "choose-photo" }, onRemovePhoto = { calls += "remove-photo" }, onSave = { name, username, avatar ->
                        calls += "save:$name:$username:$avatar"; busy = true
                    })
            }
        }
        compose.onNodeWithText("Save").performClick()
        compose.onNodeWithText("Saving…").assertIsNotEnabled()
        compose.onNodeWithText("Choose photo").assertIsNotEnabled()
        compose.onNodeWithText("Cancel").assertIsNotEnabled()
        assertEquals(listOf("save:Synthetic:synthetic:"), calls)
    }
    @Test fun editFormChoosesPhotoWithoutSavingProfile() {
        compose.setContent { NuphosTheme {
            ai.nuphos.android.ui.profile.EditProfileForm(NuphosUser("fixture", name = "Synthetic", username = "synthetic"), false, null,
                onDismiss = {}, onChoosePhoto = { calls += "choose-photo" },
                onRemovePhoto = { calls += "remove-photo" }, onSave = { _, _, _ -> calls += "save" })
        } }
        compose.onNodeWithText("Choose photo").performClick()
        compose.onNodeWithText("Profile image URL (optional)").assertDoesNotExist()
        compose.onNodeWithText("Remove photo").assertDoesNotExist()
        assertEquals(listOf("choose-photo"), calls)
    }
    @Test fun editFormRejectsEmptyNameAndCancelDoesNotSave() {
        compose.setContent { NuphosTheme {
            ai.nuphos.android.ui.profile.EditProfileForm(NuphosUser("fixture", name = "Synthetic", username = "synthetic"), false, null,
                onDismiss = { calls += "cancel-edit" }, onChoosePhoto = { calls += "choose-photo" }, onRemovePhoto = { calls += "remove-photo" }, onSave = { _, _, _ -> calls += "save" })
        } }
        compose.onNodeWithText("Name").performTextClearance()
        compose.onNodeWithText("Save").assertIsNotEnabled()
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(listOf("cancel-edit"), calls)
    }
    @Test fun editFormLargeTextKeepsHeaderAndErrorReachable() {
        compose.setContent { NuphosTheme(darkTheme = true) {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                ai.nuphos.android.ui.profile.EditProfileForm(NuphosUser("fixture", name = "Synthetic long profile name for layout", username = "synthetic"), false, "Synthetic save failure",
                    onDismiss = {}, onChoosePhoto = {}, onRemovePhoto = {}, onSave = { _, _, _ -> calls += "save" })
            }
        } }
        compose.onNodeWithText("Save").assertIsDisplayed()
        compose.onNodeWithText("Cancel").assertIsDisplayed()
        compose.onNodeWithText("Synthetic save failure").performScrollTo().assertIsDisplayed()
        assertTrue(calls.isEmpty())
    }
    @Test fun visualAccountStandard() = captureAccount(false)
    @Test fun visualAccountLarge() = captureAccount(true)
    private fun captureAccount(large: Boolean) {
        render(large = large)
        compose.onNodeWithText("Signed-in devices").performScrollTo().assertIsDisplayed()
        compose.waitForIdle()
        val args = InstrumentationRegistry.getArguments()
        val stage = args.getString("captureStage") ?: "after"
        val theme = if (args.getString("fixtureDark") == "true") "dark" else "light"
        val size = if (large) "2x" else "1x"
        val dir = java.io.File(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null), "profile-lines").apply { mkdirs() }
        val bitmap = compose.onNodeWithTag("profile-group-Account").captureToImage().asAndroidBitmap()
        java.io.File(dir, "$stage-$theme-$size.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        val bounds = listOf("profile-group-Account", "profile-account-line-edit", "profile-account-line-name", "profile-account-line-username", "profile-account-line-email", "profile-account-line-devices").mapNotNull { tag ->
            val node = compose.onAllNodesWithTag(tag).fetchSemanticsNodes().firstOrNull() ?: return@mapNotNull null
            "$tag=${node.boundsInRoot}"
        }
        java.io.File(dir, "$stage-$theme-$size-bounds.txt").writeText(bounds.joinToString("\n"))
        assertTrue(calls.isEmpty())
    }
    @Test fun accountRulesAlignToTextAndHaveNoTrailingBottomRule() {
        render()
        compose.onNodeWithText("Signed-in devices").performScrollTo()
        val group = compose.onNodeWithTag("profile-group-Account").fetchSemanticsNode().boundsInRoot
        val density = InstrumentationRegistry.getInstrumentation().targetContext.resources.displayMetrics.density
        for (suffix in listOf("edit", "name", "username", "email")) {
            val line = compose.onNodeWithTag("profile-account-line-$suffix").fetchSemanticsNode().boundsInRoot
            assertEquals(16f * density, line.left - group.left, 1f)
            assertEquals(16f * density, group.right - line.right, 1f)
        }
        compose.onNodeWithTag("profile-account-line-devices").assertDoesNotExist()
        compose.onNodeWithTag("profile-disclosure-Signed-in devices", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Signed-in devices").performClick()
        assertEquals(listOf("devices"), calls)
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
