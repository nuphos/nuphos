package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.model.Team
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.chat.ChatComposer
import ai.nuphos.android.ui.theme.NuphosTheme
import ai.nuphos.android.voice.*
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import kotlin.math.PI
import kotlin.math.sin
import org.junit.Assert.assertEquals
import org.junit.After
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * #1049 against a real backend: `scripts/e2e/android-voice-stack.ts` starts one for a subscribed team,
 * whose recordings go to a stand-in Whisper that answers with the size and SHA-256 of the audio it got.
 * Its `voice.json` gives this test its arguments (`voicePort`, `voiceToken`, `voiceTeam`); skipped without
 * them. A pre-recorded WAV stands in for the microphone, so the take, the app's upload, the backend's
 * subscription check and its forwarding are all real; only the recorder and OpenAI itself are not.
 */
@RunWith(AndroidJUnit4::class)
class VoiceTranscriptionLiveDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val args = InstrumentationRegistry.getArguments()
    private val port = args.getString("voicePort")
    private val token = args.getString("voiceToken").orEmpty()
    private val teamId = args.getString("voiceTeam").orEmpty()
    private var takeFile: File? = null
    private var sends = 0
    private var store: AgentStore? = null
    private var auth: AuthSession? = null
    private lateinit var savedAccess: Any
    @Suppress("UNCHECKED_CAST") private fun accessState() = AiAccess::class.java.getDeclaredField("state").also { it.isAccessible = true }.get(AiAccess) as MutableState<Any>

    @Suppress("UNCHECKED_CAST") private fun state(target: Any, name: String, value: Any) {
        (target.javaClass.getDeclaredField(name + "$" + "delegate").also { it.isAccessible = true }.get(target) as MutableState<Any>).value = value
    }

    @Before fun isolate() { savedAccess = accessState().value }
    @After fun restore() {
        store?.disposeForConsent()
        auth?.let { (AuthSession::class.java.getDeclaredField("scope").also { it.isAccessible = true }.get(it) as CoroutineScope).cancel() }
        accessState().value = savedAccess
        takeFile?.delete()
    }

    @Test fun recordingIsTranscribedThroughTheBackendIntoTheDraft() {
        assumeTrue("Needs the voice stack's arguments", port != null)
        val wav = speechlessWav()
        val sha = MessageDigest.getInstance("SHA-256").digest(wav).joinToString("") { "%02x".format(it) }
        compose.setContent {
            val context = LocalContext.current
            val services = remember { VoiceServices(object : VoiceSettings { override var prompt = DEFAULT_WHISPER_PROMPT },
                NuphosWhisperTransport(baseUrl = "http://127.0.0.1:$port"), {
                    object : VoiceTake {
                        override fun start() { takeFile = File.createTempFile("voice-live", ".wav", context.cacheDir).apply { writeBytes(wav) } }
                        override fun level() = .5f
                        override fun stop() = requireNotNull(takeFile)
                        override fun cancel() { takeFile?.delete() }
                    }
                }, microphonePermissionGranted = { true }) }
            val agentStore = remember { AgentStore(token, context).also {
                state(it, "selectedTeam", Team(teamId, "E2E workspace"))
                it.acceptMemberships(listOf(Team(teamId, "E2E workspace")))
                this@VoiceTranscriptionLiveDeviceTest.store = it
            } }
            val authSession = remember {
                val app = context.applicationContext as NuphosApplication
                AuthSession(app, app.tokenStore).also {
                    AuthSession::class.java.getDeclaredField("token").also { f -> f.isAccessible = true }.set(it, token)
                    state(it, "state", AuthSession.State.SignedIn(NuphosUser.preview))
                    AiAccess.activate(token); AiAccess.grant(token)
                    this@VoiceTranscriptionLiveDeviceTest.auth = it
                }
            }
            NuphosTheme(darkTheme = false) { CompositionLocalProvider(LocalAgentStore provides agentStore, LocalAuthSession provides authSession, LocalVoiceServices provides services) {
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.systemBarsPadding().padding(12.dp)) {
                        Spacer(Modifier.weight(1f))
                        ChatComposer(isStreaming = false, draft = null, canSubmit = true, onSend = { sends++; true })
                    }
                }
            } }
        }
        compose.onNodeWithContentDescription("Ask Nuphos anything").performTextInput("Draft")
        compose.onNodeWithContentDescription("Voice input").performClick()
        compose.onNodeWithContentDescription("Transcribe and edit").performClick()
        compose.waitUntil(30_000) {
            compose.onAllNodesWithText("Heard", substring = true).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithContentDescription("Ask Nuphos anything")
            .assertTextContains("Draft Heard ${wav.size} bytes ${sha.take(16)} as whisper-1")
        assertEquals(0, sends)
        capture()
    }

    /** One second of a quiet 440 Hz tone, 16 kHz mono 16-bit PCM: a fixed, valid WAV. */
    private fun speechlessWav(): ByteArray {
        val samples = 16_000
        val out = ByteBuffer.allocate(44 + samples * 2).order(ByteOrder.LITTLE_ENDIAN)
        out.put("RIFF".toByteArray()).putInt(36 + samples * 2).put("WAVE".toByteArray())
        out.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(16_000).putInt(32_000).putShort(2).putShort(16)
        out.put("data".toByteArray()).putInt(samples * 2)
        for (i in 0 until samples) out.putShort((3_000 * sin(2 * PI * 440 * i / 16_000)).toInt().toShort())
        return out.array()
    }

    private fun capture() {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        Thread.sleep(500)
        val dir = File(instrumentation.targetContext.getExternalFilesDir(null), "voice-1049").apply { mkdirs() }
        val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(dir, "light-live-transcript.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
}
