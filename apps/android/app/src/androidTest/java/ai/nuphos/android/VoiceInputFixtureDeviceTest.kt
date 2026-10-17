package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalView
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.chat.ChatComposer
import ai.nuphos.android.ui.theme.NuphosTheme
import ai.nuphos.android.voice.*
import java.io.File
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** No login, real keys, microphone audio or network. Screens explicitly identify fixtures. */
@RunWith(AndroidJUnit4::class)
class VoiceInputFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private class Settings : VoiceSettings {
        var value: String? = "synthetic-fixture-key"
        override fun key() = value
        override fun saveKey(value: String) { this.value = value }
        override fun removeKey() { value = null }
        override var prompt = DEFAULT_WHISPER_PROMPT
    }
    private class Transport : WhisperTransport {
        val reply = CompletableDeferred<Transcript>()
        var uploads = 0
        var verifies = 0
        override suspend fun verify(key: String) { verifies++ }
        override suspend fun transcribe(file: File, key: String, prompt: String): Transcript {
            assertEquals("synthetic-fixture-key", key)
            uploads++
            return reply.await()
        }
    }
    private val settings = Settings()
    private val transport = Transport()
    private var takeFile: File? = null
    private var sends = 0
    private val dark get() = InstrumentationRegistry.getArguments().getString("fixtureDark") == "true"
    private fun render() {
        compose.setContent {
            val context = LocalContext.current
            FixtureAutofillIsolation()
            val services = remember { VoiceServices(settings, transport, {
                object : VoiceTake {
                    override fun start() { takeFile = File.createTempFile("voice-fixture", ".m4a", context.cacheDir).apply { writeText("synthetic audio") } }
                    override fun level() = .6f
                    override fun stop() = requireNotNull(takeFile)
                    override fun cancel() { takeFile?.delete() }
                }
            }, microphonePermissionGranted = { true }) }
            val store = remember { AgentStore("synthetic-no-credentials", context) }
            NuphosTheme(darkTheme = dark) { CompositionLocalProvider(LocalAgentStore provides store, LocalVoiceServices provides services) {
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.systemBarsPadding().padding(12.dp)) {
                        Text("FIXTURE · synthetic audio / synthetic OpenAI · no upload", style = MaterialTheme.typography.labelSmall)
                        Spacer(Modifier.weight(1f))
                        ChatComposer(isStreaming = false, onSend = { sends++; true })
                    }
                }
            } }
        }
    }
    @Test fun waveformCancelAndTranscriptionPreserveDraftWithoutSending() {
        render()
        compose.onNodeWithContentDescription("Ask Nuphos anything").performTextInput("Existing draft")
        compose.onNodeWithContentDescription("Voice input").performClick()
        compose.onNodeWithContentDescription("Finish voice input").assertIsEnabled()
        capture("01-recording-fixture")
        compose.onNodeWithContentDescription("Cancel voice input").performClick()
        compose.onNodeWithContentDescription("Ask Nuphos anything").assertTextContains("Existing draft")
        assertFalse(takeFile!!.exists()); assertEquals(0, transport.uploads)
        compose.onNodeWithContentDescription("Voice input").performClick()
        compose.onNodeWithContentDescription("Finish voice input").performClick()
        compose.onNodeWithText("Transcribing…").assertIsDisplayed()
        compose.onNodeWithContentDescription("Finish voice input").assertIsNotEnabled()
        capture("02-transcribing-fixture")
        compose.runOnIdle { transport.reply.complete(Transcript("语音输入测试", "chinese")) }
        compose.waitUntil(5_000) { compose.onAllNodesWithContentDescription("Ask Nuphos anything").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Ask Nuphos anything").assertTextContains("Existing draft 語音輸入測試")
        assertEquals(1, transport.uploads); assertEquals(0, sends); assertFalse(takeFile!!.exists())
        capture("03-draft-result-fixture")
    }
    @Test fun canceledUploadCannotInsertLateResult() {
        render()
        compose.onNodeWithContentDescription("Voice input").performClick()
        compose.onNodeWithContentDescription("Finish voice input").performClick()
        compose.onNodeWithText("Transcribing…").assertIsDisplayed()
        compose.onNodeWithContentDescription("Cancel voice input").performClick()
        compose.runOnIdle { transport.reply.complete(Transcript("must not appear", "english")) }
        compose.onNodeWithContentDescription("Ask Nuphos anything").assertTextContains("")
        compose.onNodeWithText("must not appear").assertDoesNotExist()
        assertEquals(0, sends); assertFalse(takeFile!!.exists())
    }
    @Test fun missingKeyShowsBillingDisclosureAndCancelDoesNotRecord() {
        settings.value = null
        render()
        compose.onNodeWithContentDescription("Voice input").performClick()
        compose.onNodeWithText("OpenAI API key").assertIsDisplayed()
        compose.onNodeWithText("recordings are sent to OpenAI and billed to your account.", substring = true).assertIsDisplayed()
        capture("04-key-disclosure-fixture")
        compose.onNodeWithText("Cancel").performClick()
        assertNull(takeFile); assertEquals(0, transport.uploads); assertEquals(0, transport.verifies)
    }
    @Test fun verifiedSyntheticKeyStartsOneTakeAndAccountControlsPersistPrompt() {
        settings.value = null
        render()
        compose.onNodeWithContentDescription("Voice input").performClick()
        compose.onNodeWithText("sk-…").performTextInput("synthetic-fixture-key")
        compose.onNodeWithText("Save").performClick()
        compose.onNodeWithContentDescription("Finish voice input").assertIsDisplayed()
        // The key dialog and IME are separate Android windows; let them close before tapping behind them.
        Thread.sleep(500)
        compose.waitForIdle()
        assertEquals(1, transport.verifies)
        compose.onNodeWithContentDescription("Cancel voice input").performClick()
        compose.runOnIdle { assertFalse(takeFile!!.exists()) }
    }
    @Test fun accountCanRemoveKeyAndEditOrResetPrompt() {
        val services = VoiceServices(settings, transport, { error("No recording from Account") })
        compose.setContent {
            FixtureAutofillIsolation()
            NuphosTheme(darkTheme = dark) { Surface(Modifier.fillMaxSize()) {
                Column(Modifier.systemBarsPadding().padding(12.dp)) {
                    Text("FIXTURE · synthetic settings / no real key", style = MaterialTheme.typography.labelSmall)
                    VoiceSettingsSection(services)
                }
            } }
        }
        compose.onNodeWithText("OpenAI API key saved on this device").assertIsDisplayed()
        capture("05-account-settings-fixture")
        compose.onNodeWithText("Remove OpenAI API key").performClick()
        assertNull(settings.value)
        compose.onNodeWithText("Transcription prompt").performTextReplacement("Fixture vocabulary")
        compose.runOnIdle { assertEquals("Fixture vocabulary", settings.prompt) }
        compose.onNodeWithText("Reset prompt").performClick()
        compose.runOnIdle { assertEquals(DEFAULT_WHISPER_PROMPT, settings.prompt) }
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        // Compose idle does not include the platform IME/window transition.
        Thread.sleep(500)
        instrumentation.waitForIdleSync()
        val dir = File(instrumentation.targetContext.getExternalFilesDir(null), "whisper-1235").apply { mkdirs() }
        val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(dir, "${if (dark) "dark" else "light"}-$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
}

/** Disable autofill only on the isolated fixture window, never in device settings. */
@Composable
private fun FixtureAutofillIsolation() {
    val view = LocalView.current
    val context = LocalContext.current
    DisposableEffect(view) {
        val root = view.rootView
        val previous = root.importantForAutofill
        val manager = context.getSystemService(android.view.autofill.AutofillManager::class.java)
        manager?.cancel()
        root.importantForAutofill = android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        onDispose { manager?.cancel(); root.importantForAutofill = previous }
    }
}
