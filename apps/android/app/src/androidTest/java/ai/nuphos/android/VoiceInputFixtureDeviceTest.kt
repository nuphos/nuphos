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
import org.junit.Before
import org.junit.After
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.model.Team
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.ui.LocalAuthSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import org.junit.runner.RunWith

/** No login, real keys, microphone audio or network. Screens explicitly identify fixtures. */
@RunWith(AndroidJUnit4::class)
class VoiceInputFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private class Settings : VoiceSettings {
        override var prompt = DEFAULT_WHISPER_PROMPT
    }
    private class Transport : WhisperTransport {
        val reply = CompletableDeferred<Transcript>()
        var uploads = 0
        override suspend fun transcribe(file: File, token: String, teamId: String, prompt: String): Transcript {
            assertEquals("synthetic-no-credentials", token)
            assertEquals("fixture-team", teamId)
            uploads++
            return reply.await()
        }
    }
    private val settings = Settings()
    private val transport = Transport()
    private var takeFile: File? = null
    private var sends = 0
    private var submitted = ""
    private var boundDraft: ai.nuphos.android.session.ComposerDrafts.Lease? = null
    private val admission = mutableStateOf(true)
    private lateinit var savedAccess: Any
    private var fixtureStore: AgentStore? = null
    private var fixtureAuth: AuthSession? = null
    @Suppress("UNCHECKED_CAST") private fun accessState() = AiAccess::class.java.getDeclaredField("state").also { it.isAccessible = true }.get(AiAccess) as MutableState<Any>
    @Suppress("UNCHECKED_CAST") private fun state(target: Any, name: String, value: Any) {
        (target.javaClass.getDeclaredField(name + "$" + "delegate").also { it.isAccessible = true }.get(target) as MutableState<Any>).value = value
    }
    @Before fun isolate() {
        check(InstrumentationRegistry.getInstrumentation().targetContext.packageName.endsWith(".agentsaudit1382"))
        savedAccess = accessState().value
    }
    @After fun restore() {
        fixtureStore?.disposeForConsent()
        fixtureAuth?.let { (AuthSession::class.java.getDeclaredField("scope").also { it.isAccessible = true }.get(it) as CoroutineScope).cancel() }
        accessState().value = savedAccess
    }
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
            val store = remember { AgentStore("synthetic-no-credentials", context).also {
                fixtureStore = it
                state(it, "selectedTeam", Team("fixture-team", "Synthetic workspace"))
                it.acceptMemberships(listOf(Team("fixture-team", "Synthetic workspace")))
            } }
            val auth = remember {
                val app = context.applicationContext as NuphosApplication
                AuthSession(app, app.tokenStore).also {
                    fixtureAuth = it
                    AuthSession::class.java.getDeclaredField("token").also { f -> f.isAccessible = true }.set(it, "synthetic-no-credentials")
                    state(it, "state", AuthSession.State.SignedIn(NuphosUser.preview))
                    AiAccess.activate("synthetic-no-credentials"); AiAccess.grant("synthetic-no-credentials")
                }
            }
            NuphosTheme(darkTheme = dark) { CompositionLocalProvider(androidx.compose.ui.platform.LocalDensity provides androidx.compose.ui.unit.Density(androidx.compose.ui.platform.LocalDensity.current.density, if (InstrumentationRegistry.getArguments().getString("fixtureLarge") == "true") 2f else androidx.compose.ui.platform.LocalDensity.current.fontScale), LocalAgentStore provides store, LocalAuthSession provides auth, LocalVoiceServices provides services) {
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.systemBarsPadding().padding(12.dp)) {
                        Text("FIXTURE · synthetic audio / synthetic OpenAI · no upload", style = MaterialTheme.typography.labelSmall)
                        Spacer(Modifier.weight(1f))
                        ChatComposer(isStreaming = false, draft = boundDraft, canSubmit = admission.value, onSend = { submitted = it.text; sends++; true })
                    }
                }
            } }
        }
    }
    @Test fun waveformCancelAndTranscriptionPreserveDraftWithoutSending() {
        render()
        compose.onNodeWithContentDescription("Ask Nuphos anything").performTextInput("Existing draft")
        compose.onNodeWithContentDescription("Voice input").performClick()
        compose.onNodeWithContentDescription("Transcribe and edit").assertIsEnabled()
        capture("01-recording-fixture")
        compose.onNodeWithContentDescription("Cancel voice input").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithContentDescription("Ask Nuphos anything").fetchSemanticsNodes().size == 1 }
        compose.onNodeWithContentDescription("Ask Nuphos anything").assertTextContains("Existing draft")
        assertFalse(takeFile!!.exists()); assertEquals(0, transport.uploads)
        compose.onNodeWithContentDescription("Voice input").performClick()
        compose.onNodeWithContentDescription("Transcribe and edit").performClick()
        compose.onNodeWithText("Transcribing…").assertIsDisplayed()
        compose.onNodeWithContentDescription("Transcribe and edit").assertIsNotEnabled()
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
        compose.onNodeWithContentDescription("Transcribe and edit").performClick()
        compose.onNodeWithText("Transcribing…").assertIsDisplayed()
        compose.onNodeWithContentDescription("Cancel voice input").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithContentDescription("Ask Nuphos anything").fetchSemanticsNodes().size == 1 }
        compose.runOnIdle { transport.reply.complete(Transcript("must not appear", "english")) }
        compose.onNodeWithContentDescription("Ask Nuphos anything").assertTextContains("")
        compose.onNodeWithText("must not appear").assertDoesNotExist()
        assertEquals(0, sends); assertFalse(takeFile!!.exists())
    }
    @Test fun workspaceChangeCancelsUploadAndDoesNotAppendLateWords() {
        render()
        compose.onNodeWithContentDescription("Ask Nuphos anything").performTextInput("Keep")
        compose.onNodeWithContentDescription("Voice input").performClick()
        compose.onNodeWithContentDescription("Transcribe and edit").performClick()
        compose.onNodeWithText("Transcribing…").assertIsDisplayed()
        compose.runOnIdle { state(requireNotNull(fixtureStore), "selectedTeam", Team("other-fixture-team", "Other workspace")) }
        compose.runOnIdle { transport.reply.complete(Transcript("private late result", "english")) }
        compose.onNodeWithContentDescription("Ask Nuphos anything").assertTextContains("Keep")
        compose.onNodeWithText("private late result").assertDoesNotExist()
        assertEquals(0, sends); assertFalse(takeFile!!.exists())
    }
    @Test fun subscriptionRequiredPreservesDraftWithoutSending() {
        render()
        compose.onNodeWithContentDescription("Ask Nuphos anything").performTextInput("Keep this draft")
        compose.onNodeWithContentDescription("Voice input").performClick()
        compose.onNodeWithContentDescription("Transcribe and edit").performClick()
        compose.runOnIdle { transport.reply.completeExceptionally(VoiceFailure(402)) }
        compose.onNodeWithContentDescription("Ask Nuphos anything").assertTextContains("Keep this draft")
        compose.onNodeWithText("subscription", substring = true).assertIsDisplayed()
        assertEquals(0, sends)
        capture("04-subscription-required")
    }
    @Test fun explicitVoiceSendUsesNormalComposerSubmissionOnce() {
        render()
        compose.onNodeWithContentDescription("Ask Nuphos anything").performTextInput("Existing draft")
        compose.onNodeWithContentDescription("Voice input").performClick()
        compose.onNodeWithContentDescription("Transcribe and send").performClick()
        compose.onNodeWithText("Transcribing…").assertIsDisplayed()
        compose.onNodeWithContentDescription("Transcribe and send").assertIsNotEnabled()
        compose.runOnIdle { transport.reply.complete(Transcript("spoken words", "english")) }
        compose.waitUntil(5_000) { sends == 1 }
        assertEquals("Existing draft spoken words", submitted)
        assertEquals(1, transport.uploads); assertFalse(takeFile!!.exists())
        capture("06-explicit-send")
    }
    @Test fun admissionLostDuringTranscriptionKeepsEditableText() {
        render()
        compose.onNodeWithContentDescription("Ask Nuphos anything").performTextInput("Keep")
        compose.onNodeWithContentDescription("Voice input").performClick()
        compose.onNodeWithContentDescription("Transcribe and send").performClick()
        compose.runOnIdle { admission.value = false }
        compose.runOnIdle { transport.reply.complete(Transcript("spoken words", "english")) }
        compose.waitUntil(5_000) { compose.onAllNodesWithContentDescription("Ask Nuphos anything").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Ask Nuphos anything").assertTextContains("Keep spoken words")
        assertEquals(0, sends); assertEquals(1, transport.uploads)
        capture("07-admission-keeps-draft")
    }
    @Test fun unavailableSendStillAllowsTranscriptionForEditing() {
        compose.runOnIdle { admission.value = false }
        render()
        compose.onNodeWithContentDescription("Voice input").performClick()
        compose.onNodeWithContentDescription("Transcribe and edit").assertIsEnabled()
        compose.onNodeWithContentDescription("Transcribe and send").assertIsNotEnabled()
        capture("08-edit-only")
        compose.onNodeWithContentDescription("Transcribe and edit").performClick()
        compose.runOnIdle { transport.reply.complete(Transcript("editable words", "english")) }
        compose.waitUntil(5_000) { compose.onAllNodesWithContentDescription("Ask Nuphos anything").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Ask Nuphos anything").assertTextContains("editable words")
        assertEquals(0, sends)
    }
    @Test fun rejectedTranscriptWriteNeverSendsExistingDraftOrAttachments() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
        val key = ai.nuphos.android.session.ComposerDrafts.Key(NuphosUser.preview.id, "fixture-team",
            ai.nuphos.android.session.ComposerDrafts.Destination.Chat("voice-write-failure"))
        val original = "Keep original " + "x".repeat(ai.nuphos.android.data.IncomingShareIntents.MAX_TEXT - 18)
        val file = ai.nuphos.android.model.ComposerAttachment(name = "keep.txt",
            kind = ai.nuphos.android.model.ComposerAttachment.Kind.File("synthetic".toByteArray(), "text/plain"))
        kotlinx.coroutines.runBlocking {
            app.incomingShares.bindAccount(key.accountId)
            val id = app.incomingShares.begin(key.accountId)!!
            app.incomingShares.loaded(id, original, app.shareDraftStore.retain(listOf(file)) {})
            app.incomingShares.choose(id, key)
            assertTrue(app.incomingShares.consumed(id, key, original))
        }
        val drafts = ai.nuphos.android.session.ComposerDrafts()
        boundDraft = drafts.bind(key.accountId, key.teamId, key.destination)!!
        boundDraft!!.write(original)
        try {
            render()
            compose.onNodeWithContentDescription("Voice input").performClick()
            compose.onNodeWithContentDescription("Transcribe and send").performClick()
            compose.runOnIdle { transport.reply.complete(Transcript("recognized words exceed the text limit", "english")) }
            compose.onNodeWithText("Could not add the transcript", substring = true).assertIsDisplayed()
            compose.onNodeWithText("recognized words exceed the text limit").assertIsDisplayed()
            assertEquals(0, sends)
            assertEquals(original, boundDraft!!.text)
            assertEquals(listOf("keep.txt"), app.incomingShares.attachments(key).map { it.name })
            compose.onNodeWithText("Discard transcript").performClick()
            compose.onNodeWithContentDescription("Ask Nuphos anything").assertTextContains(original)
            compose.onNodeWithText("TXT").assertExists()
        } finally { kotlinx.coroutines.runBlocking { app.incomingShares.drop(key) } }
    }
    @Test fun accountExplainsSubscriptionAndEditsOrResetsPrompt() {
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
        compose.onNodeWithText("Voice input is included with a Nuphos subscription.").assertIsDisplayed()
        compose.onNodeWithText("OpenAI API key").assertDoesNotExist()
        capture("05-account-settings-fixture")
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
        val dir = File(instrumentation.targetContext.getExternalFilesDir(null), "voice-1410").apply { mkdirs() }
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
