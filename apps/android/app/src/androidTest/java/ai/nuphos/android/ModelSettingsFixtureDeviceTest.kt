package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.SessionConfigState
import ai.nuphos.android.session.ModelSettingsStore
import ai.nuphos.android.ui.chat.ModelSettingsSheet
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.launch
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Standalone synthetic controls; never reads auth/preferences or contacts any endpoint. */
@RunWith(AndroidJUnit4::class)
class ModelSettingsFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    @org.junit.Before fun requireIsolatedPackage() {
        org.junit.Assume.assumeTrue("Requires the isolated model fixture package",
            InstrumentationRegistry.getInstrumentation().targetContext.packageName == "ai.nuphos.android.modelfixture")
    }
    private lateinit var store: ModelSettingsStore
    private var busy = false
    private var failWrite = false
    private var writes = 0
    private var model = "a"
    private var effort = "low"
    private var fast = "off"
    private fun state() = SessionConfigState(if (busy) "busy" else "ready", buildList {
        add(SessionConfigState.Option("model", "Model", "model", model,
            listOf(SessionConfigState.Choice("a", "Alpha", "Balanced fixture model"), SessionConfigState.Choice("b", "Beta", "Fast fixture model"))))
        if (model == "a") {
            add(SessionConfigState.Option("effort", "Effort", "effort", effort, listOf(SessionConfigState.Choice("low", "Low"), SessionConfigState.Choice("high", "High"))))
            add(SessionConfigState.Option("fast", "Fast", "fast", fast, listOf(SessionConfigState.Choice("off", "Off"), SessionConfigState.Choice("on", "On"))))
        }
    })
    private fun render(newChat: Boolean = false, offline: Boolean = false) {
        compose.setContent {
            fixtureLightStatusBar()
            val scope = rememberCoroutineScope()
            store = remember { ModelSettingsStore({ true }, { true }, { busy }, { pick ->
                if (newChat) model = pick["model"] ?: model
                if (offline) SessionConfigState("offline", emptyList()) else state()
            }, if (newChat) null else ({ id, value ->
                writes++; if (failWrite) error("synthetic failure")
                if (id == "model") model = value
                if (id == "effort") effort = value
                if (id == "fast") fast = value
                state()
            })) }
            NuphosTheme(darkTheme = false) {
                Surface(Modifier.fillMaxSize().systemBarsPadding()) {
                    Column {
                        Button(onClick = { busy = false; scope.launch { store.refresh() } }) { Text("Finish synthetic reply") }
                        ModelSettingsSheet(store, {})
                    }
                }
            }
        }
        compose.waitUntil { store.config != null }
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        android.os.SystemClock.sleep(500)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        File(context.getExternalFilesDir(null), name).outputStream().use {
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }
    @Test fun newConversationLegalControlsAndModelDependentReset() {
        render(newChat = true)
        compose.onNodeWithText("On").assertIsDisplayed()
        compose.onNodeWithText("Done").assertIsDisplayed()
        capture("model-new-light.png")
        compose.onNodeWithText("Beta").performClick()
        compose.waitUntil { store.config?.modelTitle == "Beta" && !store.saving }
        assertEquals(mapOf("model" to "b"), store.initialPick)
        compose.onNodeWithText("Effort").assertDoesNotExist()
        compose.onNodeWithText("Fast").assertDoesNotExist()
        capture("model-new-beta-light.png")
        assertEquals(0, writes)
    }
    @Test fun busySelectionShowsPendingAndCancelNeverWrites() {
        busy = true; render()
        compose.onNodeWithText("Beta").performClick()
        compose.onNodeWithText("Changes apply after this reply.").assertExists()
        capture("model-pending-light.png")
        assertEquals(0, writes)
        compose.onNodeWithText("Cancel pending changes").performClick()
        compose.runOnIdle { assertTrue(store.pending.isEmpty()) }
        assertEquals(0, writes)
    }
    @Test fun failedWriteRetainsSelectionAndRetryAppliesIt() {
        failWrite = true; render()
        compose.onNodeWithText("Beta").performClick()
        compose.waitUntil { store.error != null }
        capture("model-error-light.png")
        compose.runOnIdle { failWrite = false }
        compose.onNodeWithText("Try again").performClick()
        compose.waitUntil { store.pending.isEmpty() && store.config?.modelTitle == "Beta" }
        assertEquals(2, writes)
        capture("model-retry-light.png")
    }
    @Test fun offlineShowsUnavailableWithoutSelectableControls() {
        render(offline = true)
        compose.onNodeWithText("This runtime is offline. Model settings return when it reconnects.").assertExists()
        compose.onNodeWithText("Alpha").assertDoesNotExist()
        capture("model-offline-light.png")
        assertEquals(0, writes)
    }
    @Test fun composerEntryBeforeAfterAndSheetNavigation() {
        var hasSettings by mutableStateOf(false)
        compose.setContent {
            fixtureLightStatusBar()
            val context = androidx.compose.ui.platform.LocalContext.current
            val agents = remember { ai.nuphos.android.session.AgentStore("synthetic", context) }
            val settings = remember { ModelSettingsStore({ true }, { true }, { false }, { state() }) }
            LaunchedEffect(settings) { settings.refresh() }
            CompositionLocalProvider(ai.nuphos.android.ui.LocalAgentStore provides agents) {
                NuphosTheme(darkTheme = false) {
                    Surface(Modifier.fillMaxSize().systemBarsPadding()) {
                        Column(verticalArrangement = Arrangement.Bottom) {
                            ai.nuphos.android.ui.chat.ChatComposer(isStreaming = false, onSend = { false }, showControls = true,
                                selection = ai.nuphos.android.model.CredentialSelection(), mode = ai.nuphos.android.model.PermissionMode.Auto,
                                modelSettings = if (hasSettings) settings else null)
                        }
                    }
                }
            }
        }
        compose.onNodeWithContentDescription("Ask Nuphos anything").performClick().performTextInput("Synthetic draft")
        compose.onNodeWithText("Alpha").assertDoesNotExist()
        capture("model-composer-before-light.png")
        compose.runOnIdle { hasSettings = true }
        compose.onNodeWithText("Alpha").assertExists()
        capture("model-composer-after-light.png")
        compose.onNodeWithText("Alpha").performClick()
        compose.onNodeWithText("Beta").assertExists()
    }

    @Composable private fun fixtureLightStatusBar() {
        val view = androidx.compose.ui.platform.LocalView.current
        SideEffect {
            (view.context as? android.app.Activity)?.window?.insetsController?.setSystemBarsAppearance(
                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS)
        }
    }
    @Test fun effortAndFastChoicesScrollAndApplyIndependently() {
        render()
        compose.onNodeWithText("High").performScrollTo().performClick()
        compose.waitUntil { effort == "high" && !store.saving }
        compose.onNodeWithText("On").performScrollTo().performClick()
        compose.waitUntil { fast == "on" && !store.saving }
        assertEquals(2, writes)
        compose.onNodeWithText("Done").performScrollTo()
        compose.onNodeWithText("On").assertIsDisplayed()
        capture("model-effort-fast-light.png")
    }

}
