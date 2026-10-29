package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.Alignment
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.*
import ai.nuphos.android.model.*
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalConnectorsStore
import ai.nuphos.android.ui.agent.RuntimeSetupSheet
import ai.nuphos.android.ui.chat.ChatComposer
import ai.nuphos.android.ui.connectors.ConnectorsPage
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Synthetic screenshot fixtures only; never run on a signed-in personal device. */
@RunWith(AndroidJUnit4::class)
class ReviewVisualFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val runtime = AgentRuntime("visual-agent", "codex", "Studio laptop", "active", "local")
    private fun selection() = RuntimeSelections.Selection("visual-account", "507f1f77bcf86cd799439011").also {
        it.saveCatalog(listOf(runtime)); it.select(runtime.id)
    }
    @Test fun composer() {
        val selection = selection()
        compose.setContent {
            val context = LocalContext.current
            val store = remember { AgentStore("synthetic", context) }
            NuphosTheme { Surface(Modifier.fillMaxSize()) { CompositionLocalProvider(LocalAgentStore provides store) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
                    ChatComposer(isStreaming = false, onSend = { false }, showControls = true, agent = selection, onChooseAgent = {})
                }
            } } }
        }
        compose.onNodeWithContentDescription("Ask Nuphos anything").performTextInput("Review this change before sending.")
        androidx.test.espresso.Espresso.closeSoftKeyboard()
        compose.waitForIdle()
        capture("composer")
    }
    @Test fun quotaPicker() {
        val selection = selection()
        val api = AgentRuntimeApi("synthetic", selection.teamId, OkHttpClient.Builder().addInterceptor {
            check(it.request().method == "GET")
            Response.Builder().request(it.request()).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body("""{"runtimes":[{"id":"visual-agent","provider":"codex","label":"Studio laptop","status":"active","kind":"local"}]}""".toResponseBody(Http.jsonMedia)).build()
        }.build())
        compose.setContent {
            val scope = rememberCoroutineScope()
            val setup = remember { RuntimeSetupStore(api, scope, { true }, { false }, selection, {}) }
            NuphosTheme { RuntimeSetupSheet(setup, {}, quotas = mapOf(runtime.id to RuntimeQuota(runtime.id, true,
                windows = listOf(RuntimeQuota.Window("5h", 31.0, "2030-01-01T12:00:00Z"), RuntimeQuota.Window("7d", 59.0, "2030-01-07T12:00:00Z"))))) }
        }
        compose.onNodeWithText("Studio laptop").assertIsDisplayed()
        // RuntimeSetupSheet deliberately sets FLAG_SECURE. Verify quota text through
        // semantics without exporting a blank or bypassing its screenshot protection.
        compose.onNodeWithText("41% left", substring = true).assertIsDisplayed()
    }
    @Test fun connectors() {
        val json = JsonValue.parse("""{"aws":[{"id":"visual-aws","label":"Production account"}],"upstash":[{"id":"visual-redis","label":"Redis cache"}],"github":[{"id":"visual-github","label":"Source repository"}]}""")!!
        val store = ConnectorsStore(ConnectorTransport { method, _, _, _, _ -> check(method == "GET"); json }, object : ConnectorPendingStorage {
            override fun read(): ConnectorPending? = null
            override fun write(pending: ConnectorPending?) {}
        })
        runBlocking { store.select(Team("visual-team", role = "ADMINISTRATOR")) }
        compose.setContent { NuphosTheme { Surface(Modifier.fillMaxSize()) { CompositionLocalProvider(LocalConnectorsStore provides store) { ConnectorsPage() } } } }
        compose.onNodeWithText("Add connector").assertIsDisplayed()
        capture("connectors")
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val mode = InstrumentationRegistry.getArguments().getString("visualMode") ?: "default"
        val directory = File(context.getExternalFilesDir(null), "review-389").apply { mkdirs() }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        Thread.sleep(300) // Let the platform dialog window finish drawing.
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(directory, "$mode-$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }
}
