package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.AgentRuntime
import ai.nuphos.android.data.RuntimeQuota
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.RuntimeSelections
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.chat.ChatComposer
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class ComposerAgentFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    @Test fun runtimeControlsStayAboveInputWithoutMovingSend() {
        val name = "A very long Agent name that must leave Send visible"
        val selection = RuntimeSelections.Selection("fixture-account", "fixture-team")
        selection.saveCatalog(listOf(AgentRuntime("fixture-agent", "codex", name, "active", "local")))
        selection.select("fixture-agent")
        var choices = 0
        render { ChatComposer(isStreaming = false, onSend = { true }, showControls = true,
            agent = selection, onChooseAgent = { choices++ }) }
        fun checkRow() {
            compose.onNodeWithText(name).assertIsDisplayed()
            compose.onNodeWithContentDescription("Send").assertIsDisplayed()
            val chip = compose.onNodeWithText(name).fetchSemanticsNode().boundsInRoot
            val send = compose.onNodeWithContentDescription("Send").fetchSemanticsNode().boundsInRoot
            val input = compose.onNodeWithContentDescription("Ask Nuphos anything").fetchSemanticsNode().boundsInRoot
            assertTrue("Runtime control belongs above the input", chip.bottom <= input.top)
            assertTrue("Send remains below the runtime control", send.top >= chip.bottom)
        }
        compose.onNodeWithText(name).assertDoesNotExist()
        compose.onNodeWithContentDescription("Photos").assertDoesNotExist()
        compose.onNodeWithContentDescription("Send").assertIsDisplayed()
        compose.onNodeWithContentDescription("Voice input").assertIsDisplayed()
        compose.onNodeWithContentDescription("Ask Nuphos anything").performClick()
        compose.onNodeWithContentDescription("Photos").assertIsDisplayed()
        compose.onNodeWithContentDescription("Files").assertIsDisplayed()
        compose.onNodeWithContentDescription("Paste").assertIsDisplayed()
        checkRow()
        val send = compose.onNodeWithContentDescription("Send").fetchSemanticsNode().boundsInRoot
        val composer = compose.onNodeWithContentDescription("Ask Nuphos anything").fetchSemanticsNode().boundsInRoot
        assertTrue("Send must remain at the right edge", send.right >= composer.right - 12f)
        compose.onNodeWithText(name).performClick()
        assertEquals(1, choices)
        compose.onNodeWithContentDescription("Ask Nuphos anything").performTextInput("line one\nline two")
        compose.waitForIdle()
        checkRow()
        compose.onAllNodesWithText(name).assertCountEquals(1)
        compose.onNodeWithContentDescription("Send").assertIsEnabled()
        capture("agent-beside-send")
    }
    @Test fun existingAgentOpensUsageAndUnavailableUsageDoesNotBlockSend() {
        val quota = mutableStateOf<RuntimeQuota?>(RuntimeQuota("fixture-agent", true,
            windows = listOf(RuntimeQuota.Window("5h", 43.0, "2030-01-01T00:00:00Z"))))
        render { ChatComposer(isStreaming = false, onSend = { true }, showControls = true, agentLabel = "Existing Agent", agentQuota = quota.value) }
        compose.onNodeWithContentDescription("Ask Nuphos anything").performClick()
        compose.onNodeWithText("Existing Agent").performClick()
        compose.onNodeWithText("5h: 57% left", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Done").performClick()
        compose.runOnIdle { quota.value = null }
        compose.onNodeWithText("Existing Agent").performClick()
        compose.onNodeWithText("Usage unavailable").assertIsDisplayed()
        compose.onNodeWithText("Done").performClick()
        compose.onNodeWithContentDescription("Ask Nuphos anything").performTextInput("still can send")
        compose.onNodeWithContentDescription("Send").assertIsEnabled()
    }
    @Test fun streamingKeepsQueueAndStopAsSeparateActions() {
        var queued = 0
        var stopped = 0
        render { ChatComposer(isStreaming = true, onSend = { queued++; true }, onStop = { stopped++ }) }
        compose.onNodeWithContentDescription("Queue a message").performTextInput("Follow up after this turn")
        compose.onNodeWithContentDescription("Queue message").assertIsEnabled().performClick()
        compose.waitUntil { queued == 1 }
        compose.onNodeWithContentDescription("Stop").assertIsDisplayed().performClick()
        assertEquals(1, stopped)
        assertEquals(1, queued)
    }
    private fun render(content: @Composable () -> Unit) {
        compose.setContent {
            val context = LocalContext.current
            val store = remember { AgentStore("synthetic-no-credentials", context) }
            NuphosTheme { CompositionLocalProvider(LocalAgentStore provides store, ai.nuphos.android.ui.LocalAuthSession provides (androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as ai.nuphos.android.NuphosApplication).authSession) {
                Box(Modifier.widthIn(max = 320.dp)) { content() }
            } }
        }
    }
    private fun capture(name: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val dir = File(instrumentation.targetContext.getExternalFilesDir(null), "android-next-1143").apply { mkdirs() }
        val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
}
