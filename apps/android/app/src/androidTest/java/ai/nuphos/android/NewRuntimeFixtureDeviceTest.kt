package ai.nuphos.android

import android.content.res.Configuration
import android.graphics.Bitmap
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.*
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.agent.NewRuntimeSheet
import ai.nuphos.android.ui.agent.RuntimeInventory
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.Locale

/** Product sheets with synthetic transports; no account or provider login is contacted. */
@RunWith(AndroidJUnit4::class)
class NewRuntimeFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var store: NewRuntimeStore
    private var creates = 0; private var deletes = 0; private var finished = false
    private fun shot(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.waitForIdleSync()
        val shot = instrumentation.uiAutomation.takeScreenshot()
        // The additional test output is what CI uploads with the report.
        listOfNotNull(instrumentation.targetContext.getExternalFilesDir(null), InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")?.let(::File))
            .forEach { dir -> File(dir, name).outputStream().use { shot.compress(Bitmap.CompressFormat.PNG, 100, it) } }
    }
    @Test fun useOnlyComputerShowsOwnerInstructionInsteadOfCreate() {
        lateinit var inventory: RuntimesStore
        compose.setContent {
            val scope = rememberCoroutineScope()
            inventory = remember { RuntimesStore(scope, { true }, { emptyList() }, { emptyMap() },
                { listOf(RuntimeDevice("use-only", "Shared Laptop", true, null, "unavailable", null, null, null, "use")) }, {}) }
            LaunchedEffect(inventory) { inventory.refresh() }
            NuphosTheme { Surface(Modifier.fillMaxSize()) { RuntimeInventory(inventory, {}) } }
        }
        compose.waitUntil { inventory.loaded }
        compose.onNodeWithText(InstrumentationRegistry.getInstrumentation().targetContext.getString(R.string.new_runtime_ask_owner)).assertIsDisplayed()
        compose.onNodeWithTag("new-runtime-use-only").assertDoesNotExist()
        shot("new-runtime-owner-instruction.png")
    }
    /** Antigravity's sign-in is the computer's own: the list offers it only to sign in again (#4905). */
    @Test fun antigravityIsListedOnlyWhenItCanBeSignedIn() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val app = instrumentation.targetContext
        val zh = app.createConfigurationContext(Configuration(app.resources.configuration).apply { setLocale(Locale.forLanguageTag("zh-CN")) })
        val device = RuntimeDevice("host", "Studio", true, null, "unavailable", null, null, null, "manage")
        fun antigravity(signedIn: Boolean) = AgentRuntime("agy", "antigravity", "Antigravity", "active", "local", signedIn = signedIn,
            local = RuntimeHost("host", "Studio", true, "Antigravity"))
        val states = linkedMapOf(
            "no-antigravity" to emptyList(),
            "signed-in" to listOf(antigravity(signedIn = true)),
            "signed-out" to listOf(antigravity(signedIn = false)),
        )
        var state by mutableStateOf("no-antigravity")
        compose.setContent {
            val scope = rememberCoroutineScope()
            val existing = states.getValue(state)
            val sheet = remember(state) { NewRuntimeStore(object : RuntimeCreationTransport {
                override suspend fun create(deviceId: String, provider: String, instanceId: String, label: String): CreatedRuntime = error("Not created here")
                override suspend fun discard(deviceId: String, instanceId: String) = Unit
            }, scope, device, { existing }, { true }, {}, {}) }
            val setup = remember { RuntimeSetupStore(object : RuntimeTransport {
                override suspend fun catalog() = emptyList<AgentRuntime>()
                override suspend fun start(runtimeId: String): RuntimeLogin = error("No external provider in fixture")
                override suspend fun login(runtimeId: String): RuntimeLogin = error("No external provider in fixture")
                override suspend fun code(runtimeId: String, attemptId: String, code: String): RuntimeLogin = error("No external provider in fixture")
                override suspend fun cancel(runtimeId: String, attemptId: String) = Unit
            }, scope, { true }, { false }, RuntimeSelections.Selection("synthetic", "507f1f77bcf86cd799439011"), {},
                loginAllowed = { true }, useSelectedRuntime = false) }
            CompositionLocalProvider(LocalContext provides zh, LocalConfiguration provides zh.resources.configuration, LocalResources provides zh.resources) {
                NuphosTheme(darkTheme = false) { Surface(Modifier.fillMaxSize()) { NewRuntimeSheet(sheet, setup) } }
            }
        }
        // Every state is captured before any assertion, so a failing run still shows all three.
        val rows = states.keys.associateWith { name ->
            compose.runOnIdle { state = name }
            // OpenCode follows Antigravity's place in the list, so each shot shows where its row is or would be.
            compose.onNodeWithTag("new-runtime-provider-opencode").performScrollTo().assertIsDisplayed()
            shot("new-runtime-antigravity-$name.png")
            compose.onAllNodesWithTag("new-runtime-provider-antigravity").fetchSemanticsNodes().size
        }
        assertEquals("Antigravity is listed with nothing to offer", 0, rows["no-antigravity"])
        assertEquals("A signed-in Antigravity is listed again", 0, rows["signed-in"])
        compose.runOnIdle { state = "signed-out" }
        compose.onNodeWithTag("new-runtime-provider-antigravity").performScrollTo().assertIsEnabled()
        compose.onNodeWithText(zh.getString(R.string.new_runtime_sign_in, "Antigravity")).assertIsDisplayed()
    }
    @Test fun chooseNameCreateThenCancelCleansOnlyNewRuntime() {
        val device = RuntimeDevice("host", "Synthetic Laptop", true, null, "unavailable", null, null, null, "manage")
        compose.setContent {
            val scope = rememberCoroutineScope()
            store = remember { NewRuntimeStore(object : RuntimeCreationTransport {
                override suspend fun create(deviceId: String, provider: String, instanceId: String, label: String): CreatedRuntime {
                    creates++; return CreatedRuntime(instanceId, "created", label)
                }
                override suspend fun discard(deviceId: String, instanceId: String) { deletes++ }
            }, scope, device, { emptyList() }, { true }, {}, { finished = true }) }
            val selection = remember { RuntimeSelections.Selection("synthetic", "507f1f77bcf86cd799439011") }
            val setup = remember { RuntimeSetupStore(object : RuntimeTransport {
                override suspend fun catalog() = listOfNotNull(store.runtime)
                override suspend fun start(runtimeId: String): RuntimeLogin = error("No external provider in fixture")
                override suspend fun login(runtimeId: String): RuntimeLogin = error("No external provider in fixture")
                override suspend fun code(runtimeId: String, attemptId: String, code: String): RuntimeLogin = error("No external provider in fixture")
                override suspend fun cancel(runtimeId: String, attemptId: String) = Unit
            }, scope, { true }, { false }, selection, {}, loginAllowed = { true }, useSelectedRuntime = false) }
            NuphosTheme { Surface(Modifier.fillMaxSize()) { NewRuntimeSheet(store, setup) } }
        }
        compose.onNodeWithTag("new-runtime-provider-codex").assertIsDisplayed()
        shot("new-runtime-providers.png")
        compose.onNodeWithTag("new-runtime-provider-pi").performScrollTo().assertIsDisplayed()
        shot("new-runtime-providers-more.png")
        compose.onNodeWithTag("new-runtime-provider-codex").performScrollTo().performClick()
        compose.onNodeWithTag("new-runtime-name").assertTextContains("Codex")
        shot("new-runtime-name.png")
        compose.onNodeWithTag("new-runtime-continue").performClick()
        compose.waitUntil { store.runtime != null }
        compose.waitForIdle()
        shot("new-runtime-sign-in.png")
        compose.runOnIdle { assertEquals(1, creates) }
        compose.onNodeWithText(InstrumentationRegistry.getInstrumentation().targetContext.getString(R.string.agent_close)).performClick()
        compose.waitUntil { finished }
        compose.runOnIdle { assertEquals(1, deletes) }
    }
}
