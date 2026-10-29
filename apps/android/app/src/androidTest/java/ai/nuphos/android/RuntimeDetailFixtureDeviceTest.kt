package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.*
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.agent.RuntimeDetailPage
import ai.nuphos.android.ui.agent.RuntimeSetupSheet
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Only synthetic state. The standalone page fixture has no credentials; production sheet stays secure. */
@RunWith(AndroidJUnit4::class)
class RuntimeDetailFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val initial = AgentRuntime("synthetic-agent", "codex", "Design workspace", "active", "managed")
    private var saved = listOf(initial)
    private var updates = 0
    private var removals = 0
    private var signIns = 0
    private lateinit var store: RuntimeDetailStore
    private val selection = RuntimeSelections().bind("synthetic-account", "507f1f77bcf86cd799439011")
    private val api = object : RuntimeTransport, RuntimeManagementTransport {
        override suspend fun catalog() = saved
        override suspend fun update(runtimeId: String, label: String?, status: String?): AgentRuntime {
            updates++
            val result = saved.single().let { it.copy(label = label ?: it.label, status = status ?: it.status) }
            saved = listOf(result); return result
        }
        override suspend fun remove(runtimeId: String): Boolean { removals++; return true }
        override suspend fun create(provider: String, label: String?): AgentRuntime = error("unused")
        override suspend fun start(runtimeId: String): RuntimeLogin { signIns++; return RuntimeLogin("00000000-0000-4000-8000-000000000001", "connected", Long.MAX_VALUE) }
        override suspend fun login(runtimeId: String): RuntimeLogin = error("unused")
        override suspend fun code(runtimeId: String, attemptId: String, code: String): RuntimeLogin = error("unused")
        override suspend fun cancel(runtimeId: String, attemptId: String) = error("unused")
    }
    private fun render(dark: Boolean, admin: Boolean = true, item: AgentRuntime = initial) {
        saved = listOf(item); selection.saveCatalog(saved)
        compose.setContent {
            val scope = rememberCoroutineScope()
            val detail = remember { RuntimeDetailStore(api, api, scope, { true }, { admin }, selection, item.id, {}) }
            store = detail
            NuphosTheme(darkTheme = dark) {
                Surface {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
                        RuntimeDetailPage(detail, RuntimeQuota(item.id, true, windows = listOf(RuntimeQuota.Window("5h", 24.0, null))), {}, { signIns++ })
                    }
                }
            }
        }
    }
    private fun click(text: String) = compose.onNodeWithText(text).performScrollTo().performClick()
    private fun capture(name: String) {
        compose.waitForIdle()
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        android.os.SystemClock.sleep(500) // Let the platform dialog transition finish before capturing.
        val dir = InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null)!!
        File(dir, name).outputStream().use { InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
    @Test fun lightDetailAndDestructiveConfirmation() {
        render(false)
        compose.onNodeWithText("5h: 76% left").assertExists()
        capture("agent-detail-light.png")
        click("Remove runtime"); assertEquals(0, removals)
        compose.onNodeWithText("Remove Design workspace?").assertExists()
        capture("agent-detail-remove-light.png")
        compose.onNodeWithText("Cancel").performClick(); assertEquals(0, removals)
        click("Remove runtime")
        compose.onNode(hasText("Remove runtime") and hasAnyAncestor(isDialog())).performClick()
        compose.waitUntil { removals == 1 }
        compose.onNodeWithText("Removal is in progress. Refresh to check saved state.").assertExists()
    }
    @Test fun darkRenameEnableAndExistingSigninHandoff() {
        render(true); capture("agent-detail-dark.png")
        compose.onNodeWithText("Runtime name").performTextReplacement("Renamed fixture")
        click("Save name"); compose.waitUntil { updates == 1 && !store.busy }
        assertEquals("Renamed fixture", store.runtime?.label)
        androidx.test.espresso.Espresso.closeSoftKeyboard()
        compose.onNode(isToggleable()).performScrollTo().performClick()
        compose.waitUntil { updates == 2 && !store.busy }; assertEquals("disabled", store.runtime?.status)
        compose.onNodeWithText("Sign In Again").assertDoesNotExist()
        compose.onNode(isToggleable()).performScrollTo().performClick()
        compose.waitUntil { updates == 3 && !store.busy }
        click("Sign In Again"); assertEquals(1, signIns)
        click("Remove runtime"); capture("agent-detail-remove-dark.png")
        compose.onNodeWithText("Cancel").performClick(); assertEquals(0, removals)
    }
    @Test fun localAndMemberHaveNoDestructiveControls() {
        render(false, admin = false, item = initial.copy(kind = "local"))
        compose.onNodeWithText("Remove runtime").assertDoesNotExist()
        compose.onNodeWithText("Save name").assertIsNotEnabled()
        assertEquals(0, removals); assertEquals(0, updates)
    }
    @Test fun pickerDetailReturnsToExistingProviderFlow() {
        compose.setContent {
            val scope = rememberCoroutineScope()
            val setup = remember { RuntimeSetupStore(api, scope, { true }, { true }, selection, {}) }
            NuphosTheme { RuntimeSetupSheet(setup, {}) }
        }
        compose.waitUntil(5_000) { compose.onAllNodesWithContentDescription("Details for Design workspace").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Details for Design workspace").performClick()
        click("Sign In Again")
        compose.onNodeWithText("Start provider sign-in").assertExists()
        click("Start provider sign-in")
        compose.waitUntil(5_000) { signIns == 1 }
        assertEquals(0, updates); assertEquals(0, removals)
        assertNull(selection.selectedId) // Managing sign-in must not choose a default for new chats.
    }
}
