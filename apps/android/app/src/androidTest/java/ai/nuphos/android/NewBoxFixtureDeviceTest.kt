package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.*
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.agent.NewBoxSheet
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.launch
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Exercises product UI with a synthetic transport; never orders a paid machine. */
@RunWith(AndroidJUnit4::class)
class NewBoxFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)
    private fun shot(name: String) {
        compose.waitForIdle()
        val i = InstrumentationRegistry.getInstrumentation()
        val shot = i.uiAutomation.takeScreenshot()
        // The additional test output is what CI uploads with the report.
        listOfNotNull(i.targetContext.getExternalFilesDir(null), InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")?.let(::File))
            .forEach { dir -> File(dir, name).outputStream().use { shot.compress(Bitmap.CompressFormat.PNG, 100, it) } }
    }
    @Test fun administratorCreatesWaitsThenChoosesRuntime() {
        lateinit var store: NewBoxStore
        lateinit var scope: kotlinx.coroutines.CoroutineScope
        var rows = emptyList<AgentRuntime>()
        var created = 0
        val device = RuntimeDevice("made", "Computer 1", true, RuntimeDevice.Box("running"), "unavailable", null, null, null, "owner")
        compose.setContent {
            scope = rememberCoroutineScope()
            store = remember { NewBoxStore(object : BoxTransport {
                override suspend fun inventory() = BoxInventory(listOf(device), true)
                override suspend fun createBox(label: String): String { created++; return "made" }
                override suspend fun resumeBox(deviceId: String) = Unit
            }, { rows }, scope, { true }, {}) }
            LaunchedEffect(store) { store.refresh() }
            NuphosTheme { Surface(Modifier.fillMaxSize()) {
                NewBoxSheet(store, {}) { runtime, _ -> Text(runtime.label, Modifier.testTag("box-selected-sign-in")) }
            } }
        }
        compose.waitUntil { store.loaded }
        compose.onNodeWithTag("new-box").assertIsDisplayed()
        shot("box-guide.png")
        compose.onNodeWithTag("new-box").performClick()
        compose.onNodeWithTag("box-name").assertIsDisplayed()
        shot("box-name.png")
        compose.onNodeWithTag("box-create").performClick()
        compose.waitUntil { store.deviceId == "made" }
        compose.onNodeWithText(text(R.string.box_starting)).assertIsDisplayed()
        shot("box-starting.png")
        compose.runOnIdle {
            rows = listOf(AgentRuntime("ready", "codex", "Codex", "active", "local", signedIn = false, local = RuntimeHost("made", "Computer 1", true)))
            scope.launch { store.refresh() }
        }
        compose.waitUntil { store.phase == NewBox.Phase.Ready }
        compose.onNodeWithTag("box-login-ready").assertIsDisplayed()
        shot("box-ready.png")
        compose.onNodeWithTag("box-login-ready").performClick()
        compose.onNodeWithTag("box-selected-sign-in").assertIsDisplayed()
        compose.runOnIdle { assertEquals(1, created); store.close() }
    }
    @Test fun memberDoesNotSeeManagedComputerOffer() {
        lateinit var store: NewBoxStore
        compose.setContent {
            val scope = rememberCoroutineScope()
            store = remember { NewBoxStore(object : BoxTransport {
                override suspend fun inventory() = BoxInventory(emptyList(), false)
                override suspend fun createBox(label: String): String = error("A member must never order")
                override suspend fun resumeBox(deviceId: String) = Unit
            }, { emptyList() }, scope, { true }, {}) }
            LaunchedEffect(store) { store.refresh() }
            NuphosTheme { Surface { NewBoxSheet(store, {}) { _, _ -> } } }
        }
        compose.waitUntil { store.loaded }
        compose.onNodeWithTag("new-box").assertDoesNotExist()
        compose.onNodeWithText(text(R.string.box_step1)).assertIsDisplayed()
        shot("box-member-guide.png")
        compose.runOnIdle { store.close() }
    }
}
