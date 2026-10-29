package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
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

/** Pure synthetic callbacks: no HTTP client, credentials, real writes or account state. */
@RunWith(AndroidJUnit4::class)
class RuntimesFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private var details = ""
    private var management = 0
    private var failure = false
    private var empty = false
    private lateinit var store: RuntimesStore
    private val cloud = AgentRuntime("cloud", "codex", "Synthetic Cloud", "active", "managed")
    private val local = AgentRuntime("local", "claude-code", "Synthetic Desktop", "active", "local", local = RuntimeHost("host", "Synthetic Box", true))
    private val offline = local.copy(id = "offline", label = "Synthetic Offline", local = RuntimeHost("mac", "Synthetic Mac", false))
    private fun render(rtl: Boolean = false) {
        require(InstrumentationRegistry.getInstrumentation().targetContext.packageName == "ai.nuphos.android.runtimes1373")
        compose.setContent {
            val scope = rememberCoroutineScope()
            store = remember { RuntimesStore(scope, { true }, { if (failure) throw IOException() else if (empty) emptyList() else listOf(cloud, local, offline) },
                { mapOf("cloud" to RuntimeQuota("cloud", true, windows = listOf(RuntimeQuota.Window("Weekly", 38.0)))) },
                { listOf(RuntimeDevice("host", "Synthetic Box", true, true, "live", 22.0, RuntimeDevice.Capacity(6.0 * 1073741824,16.0 * 1073741824), RuntimeDevice.Capacity(120.0 * 1073741824,512.0 * 1073741824)), RuntimeDevice("mac", "Synthetic Mac", false, false, "offline", null, null, null)) }, {}) }
            LaunchedEffect(store) { store.refresh() }
            CompositionLocalProvider(LocalLayoutDirection provides if (rtl) LayoutDirection.Rtl else LayoutDirection.Ltr,
                LocalDensity provides Density(LocalDensity.current.density, if (rtl) 2f else 1f)) {
                NuphosTheme(darkTheme = false) { Surface { Box(Modifier.width(320.dp)) {
                    RuntimeInventory(store, true, { management++ }, { details = it })
                } } }
            }
        }
        compose.waitUntil { store.loaded }
    }
    private fun shot(name: String) {
        compose.waitForIdle()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        File(context.getExternalFilesDir(null), name).outputStream().use {
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG,100,it)
        }
    }
    @Test fun catalogQuotaOfflineAndExactDetailCallbacks() {
        render()
        compose.onNodeWithText("Cloud and servers").assertIsDisplayed()
        compose.onNodeWithText("Weekly: 62% left").assertExists()
        shot("runtimes-normal.png")
        compose.onNodeWithText("Details: Synthetic Cloud").performScrollTo().performClick()
        assertEquals("cloud", details)
        compose.onNodeWithText("Synthetic Box").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("CPU 22%").assertExists()
        compose.onNodeWithTag("runtime-inventory").performScrollToNode(hasText("Synthetic Mac"))
        compose.onNodeWithText("Offline", substring = false).assertIsDisplayed()
        shot("runtimes-computers.png")
        compose.onNodeWithText("Details: Synthetic Desktop").performScrollTo().performClick()
        assertEquals("local", details)
        compose.onNodeWithText("Manage runtimes").performScrollTo().performClick()
        assertEquals(1, management)
    }
    @Test fun emptyFailureRetryAndLargeRtlStayUsable() {
        render(true)
        compose.onNodeWithText("Manage runtimes").assertIsDisplayed()
        shot("runtimes-rtl-large.png")
        failure = true
        compose.onNodeWithText("Refresh runtimes").performClick()
        compose.waitUntil { store.errors.isNotEmpty() }
        compose.onNodeWithText("Could not refresh runtimes.").assertExists()
        assertEquals(3, store.runtimes.size)
        failure = false; empty = true
        compose.onNodeWithText("Refresh runtimes").performClick()
        compose.waitUntil { store.loaded && store.runtimes.isEmpty() }
        compose.onNodeWithText("No runtimes.", substring = true).assertExists()
        shot("runtimes-empty.png")
    }
}
