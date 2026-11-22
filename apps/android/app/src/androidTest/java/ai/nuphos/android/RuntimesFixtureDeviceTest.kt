package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.*
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.agent.RuntimeInventory
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.IOException
import org.junit.Assume.assumeTrue

/** Pure synthetic callbacks: no HTTP client, credentials, real writes or account state. */
@RunWith(AndroidJUnit4::class)
class RuntimesFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private var details = ""
    private var detailClicks = 0
    private var held: kotlinx.coroutines.CompletableDeferred<Unit>? = null
    private var management = 0
    private var failure = false
    private var empty = false
    /** `box.state` of the synthetic Box while it is not online; null keeps it online. */
    private var startingState: String? = null
    private lateinit var store: RuntimesStore
    private val cloud = AgentRuntime("cloud", "codex", "Synthetic Cloud", "active", "managed")
    private val local = AgentRuntime("local", "claude-code", "Synthetic Desktop", "active", "local", local = RuntimeHost("host", "Synthetic Box", true))
    private val offline = local.copy(id = "offline", label = "Synthetic Offline", local = RuntimeHost("mac", "Synthetic Mac", false))
    private fun render(rtl: Boolean = false, waitLoaded: Boolean = true) {
        compose.setContent {
            val scope = rememberCoroutineScope()
            store = remember { RuntimesStore(scope, { true }, { held?.await(); if (failure) throw IOException() else if (empty) emptyList() else listOf(cloud, cloud.copy(id="grok",provider="grok",label="Synthetic Grok"), cloud.copy(id="antigravity",provider="antigravity",label="Synthetic Antigravity"), cloud.copy(id="opencode",provider="opencode",label="Synthetic OpenCode"), local, offline) },
                { mapOf("cloud" to RuntimeQuota("cloud", true, windows = listOf(RuntimeQuota.Window("Weekly", 38.0, java.time.Instant.now().plusSeconds((2 * 24 + 5) * 3600L + 1800).toString())))) },
                { listOf(if (startingState != null) RuntimeDevice("host", "Synthetic Box", false, RuntimeDevice.Box(startingState), "offline", null, null, null) else RuntimeDevice("host", "Synthetic Box", true, RuntimeDevice.Box(null), "live", 22.0, RuntimeDevice.Capacity(6.0 * 1073741824,16.0 * 1073741824), RuntimeDevice.Capacity(120.0 * 1073741824,512.0 * 1073741824)), RuntimeDevice("mac", "Synthetic Mac", false, null, "offline", null, null, null)) }, {}) }
            LaunchedEffect(store) { store.refresh() }
            CompositionLocalProvider(LocalLayoutDirection provides if (rtl) LayoutDirection.Rtl else LayoutDirection.Ltr,
                LocalDensity provides Density(LocalDensity.current.density, if (rtl) 2f else 1f)) {
                RuntimeFixtureTheme { Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background) { Box(Modifier.fillMaxSize()) { Box(if(rtl) Modifier.width(320.dp) else Modifier.fillMaxSize()) {
                    RuntimeInventory(store, { details = it; detailClicks++ })
                } } } }
            }
        }
        if (waitLoaded) compose.waitUntil { store.loaded }
    }
    private fun shot(name: String) {
        compose.waitForIdle()
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        Thread.sleep(500) // Platform window/compositor settling, not product loading.
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val file = (if (InstrumentationRegistry.getArguments().getString("fixtureDark") == "true") "dark-" else "light-") + name
        val shot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        // The additional test output is what CI uploads with the report.
        listOfNotNull(context.getExternalFilesDir(null), InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")?.let(::File))
            .forEach { dir -> File(dir, file).outputStream().use { shot.compress(Bitmap.CompressFormat.PNG, 100, it) } }
    }
    @Test fun catalogQuotaOfflineAndExactDetailCallbacks() {
        render()
        compose.onNodeWithText("Cloud").assertIsDisplayed()
        // #3732: the bar says when its window resets, in days past a day.
        compose.onNodeWithText("62% left · resets in 2d 5h").assertExists()
        shot("runtimes-normal.png")
        compose.onNodeWithTag("runtime-row-cloud").performScrollTo().performClick()
        assertEquals("cloud", details); assertEquals(1, detailClicks)
        compose.onNodeWithText("Synthetic Box").performScrollTo().assertIsDisplayed()
        compose.onNodeWithContentDescription("CPU usage").assertExists()
        compose.onNodeWithTag("runtime-inventory").performScrollToNode(hasText("Synthetic Mac"))
        compose.onNodeWithText("Offline", substring = false).assertIsDisplayed()
        shot("runtimes-computers.png")
        compose.onNodeWithTag("runtime-row-local").performScrollTo().performClick()
        assertEquals("local", details)
        compose.onNodeWithText("Add runtime").assertDoesNotExist()
    }
    /** #4192: a Box coming up says Starting… then Connecting…, like Desktop and iOS, and nothing once online. */
    @Test fun aStartingBoxSaysStartingThenConnectingNotOffline() {
        startingState = "creating"
        render()
        compose.onNodeWithTag("runtime-row-local").performScrollTo()
        compose.onNodeWithText("Starting…").assertIsDisplayed()
        shot("runtimes-box-starting-4192.png")
        startingState = "connecting"
        compose.runOnIdle { store.refresh() }
        compose.waitUntil(5000) { compose.onAllNodesWithText("Connecting…").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Starting…").assertDoesNotExist()
        compose.onNodeWithTag("runtime-row-local").performScrollTo()
        shot("runtimes-box-connecting-4192.png")
        startingState = null
        compose.runOnIdle { store.refresh() }
        compose.waitUntil(5000) { compose.onAllNodesWithText("Connecting…").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithTag("runtime-row-local").performScrollTo()
        shot("runtimes-box-online-4192.png")
    }
    @Test fun firstLoadNeverShowsEmptyAndFailedRequestOffersRealRetry() {
        held = kotlinx.coroutines.CompletableDeferred()
        render(waitLoaded = false)
        compose.onNodeWithTag("runtimes-loading").assertExists()
        compose.onNodeWithText("No runtimes").assertDoesNotExist()
        compose.runOnIdle { failure = true; held!!.complete(Unit) }
        compose.waitUntil(5000) {store.errors.isNotEmpty() && !store.loading}
        compose.onNodeWithText("Couldn't load runtimes").assertIsDisplayed()
        failure=false; empty=true
        compose.onNodeWithText("Try again").performClick()
        compose.waitUntil(5000) {store.loaded && !store.loading}
        compose.onNodeWithText("No runtimes").assertIsDisplayed()
        compose.onNodeWithText("Add runtime").assertDoesNotExist()
    }
    @Test fun runtimeRowsOpenDetailsWithoutAdd() {
        render()
        compose.onNodeWithText("Add runtime").assertDoesNotExist()
        compose.onNodeWithTag("runtime-row-cloud").performClick()
        assertEquals("cloud", details);assertEquals(1,detailClicks);assertEquals(0,management)
    }
    @Test fun emptyFailureRetryAndLargeRtlStayUsable() {
        render(true)
        compose.onNodeWithText("Add runtime").assertDoesNotExist()
        shot("runtimes-rtl-large.png")
        failure = true
        compose.runOnIdle { store.refresh() }
        compose.waitUntil { store.errors.isNotEmpty() }
        compose.onNodeWithTag("runtime-inventory").performScrollToNode(hasText("Could not refresh runtimes."))
        compose.onNodeWithText("Could not refresh runtimes.").assertExists()
        assertEquals(6, store.runtimes.size)
        failure = false; empty = true
        compose.runOnIdle { store.refresh() }
        compose.waitUntil { store.loaded && store.runtimes.isEmpty() }
        compose.onNodeWithText("No runtimes", substring = true).assertExists()
        shot("runtimes-empty.png")
    }
}
