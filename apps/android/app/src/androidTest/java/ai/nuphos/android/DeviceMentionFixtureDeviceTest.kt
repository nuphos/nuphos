package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.*
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.chat.*
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.junit.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/** Separate synthetic package only: no token, preference change, socket or real permission. */
@RunWith(AndroidJUnit4::class)
class DeviceMentionFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private lateinit var store: AgentStore
    private val team = "507f1f77bcf86cd799439011"
    private val catalog = CredentialCatalog(JsonValue.parse("""{
        "devices":[{"deviceId":"synthetic-mac","label":"Fixture Mac","available":true},
                   {"deviceId":"synthetic-pc","label":"Fixture Mac","available":true},
                   {"deviceId":"synthetic-off","label":"Fixture Offline","available":false}]
    }""")!!).allItems
    private val initial = CredentialSelection(mapOf("deviceIds" to setOf("synthetic-pc", "synthetic-off"), "awsRoleIds" to setOf("synthetic-cloud")))
    private fun field() = compose.onNodeWithContentDescription("Ask Nuphos anything")
    @Before fun isolate() {
        assumeTrue("Separate fixture package required", instrumentation.targetContext.packageName == "ai.nuphos.android.mentionfixture")
        assertNull((instrumentation.targetContext.applicationContext as NuphosApplication).tokenStore.read())
        store = AgentStore("synthetic-no-credentials", instrumentation.targetContext)
    }
    @After fun cleanup() { if (::store.isInitialized) store.disposeForConsent() }
    private fun snap(name: String) {
        compose.waitForIdle()
        val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: error("No screenshot")
        val dir = File(instrumentation.targetContext.filesDir, "device-mention-synthetic").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }

    @Test fun explicitDevicePickPreservesIamAndSessionMentionsWithBoundedControls() {
        var selection by mutableStateOf(initial)
        var dark by mutableStateOf(false)
        var picks = 0
        var sends = 0
        val loads = AtomicInteger()
        val source = DeviceMentionSource(team, load = { loads.incrementAndGet(); catalog }, pick = {
            picks++
            DeviceMention.select(selection, it)?.let { next -> selection = next; true } ?: false
        })
        val sessions = SessionMentionSource(team) { listOf(AgentConversation("synthetic-chat", title = "Fixture chat")) }
        compose.setContent {
            NuphosTheme(darkTheme = dark) {
                CompositionLocalProvider(LocalAgentStore provides store) {
                    Surface(Modifier.fillMaxSize()) {
                        Column(Modifier.fillMaxSize().padding(top = 48.dp)) {
                            Text("Synthetic fixture · no real service or permissions", Modifier.padding(16.dp))
                            Spacer(Modifier.weight(1f))
                            ChatComposer(isStreaming = false, showControls = true, selection = selection,
                                mentions = sessions, devices = source, onSend = { sends++; true })
                        }
                    }
                }
            }
        }
        field().performClick().performTextInput("context\n@fiXTure")
        compose.waitUntil(5000) { compose.onAllNodesWithText("Fixture Mac").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("…-mac").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("…c-pc").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("…-mac").performScrollTo()
        compose.onNodeWithContentDescription("Attach").assertIsDisplayed()
        compose.onNodeWithContentDescription("Send").assertIsDisplayed()
        snap("synthetic-device-mention-light")
        compose.runOnIdle { dark = true }
        snap("synthetic-device-mention-dark")
        compose.onNodeWithText("Fixture Offline · Unavailable").performScrollTo().assertIsNotEnabled()
        snap("synthetic-device-mention-unavailable")
        compose.runOnIdle { assertEquals(initial, selection); assertEquals(0, picks) }
        compose.onNodeWithText("Fixture chat").performScrollTo().assertIsDisplayed()
        snap("synthetic-device-mention-mixed")
        compose.onNodeWithText("…-mac").performScrollTo().performClick()
        field().assertTextEquals("context\n@Fixture Mac ")
        compose.runOnIdle {
            assertEquals(setOf("synthetic-mac", "synthetic-pc", "synthetic-off"), selection.ids["deviceIds"])
            assertEquals(setOf("synthetic-cloud"), selection.ids["awsRoleIds"])
            assertEquals(1, picks); assertEquals(0, sends)
        }
        field().performTextReplacement("@fixture")
        compose.waitUntil(5000) { compose.onAllNodesWithText("Fixture Mac · Selected").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("…-mac").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(3, selection.ids["deviceIds"]!!.size) }
        field().performTextReplacement("@fixture")
        compose.waitUntil(5000) { compose.onAllNodesWithText("Fixture chat").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Fixture chat").performScrollTo().performClick()
        field().assertTextEquals("https://nuphos.ai/teams/$team/agent/synthetic-chat ")
        val before = loads.get()
        field().performTextReplacement("mail@example.com")
        Thread.sleep(250)
        assertEquals(before, loads.get())
        field().performTextReplacement("@fixture")
        compose.onNodeWithContentDescription("Dismiss mentions").performClick()
        field().performTextInput("x")
        Thread.sleep(250)
        compose.onNodeWithContentDescription("Dismiss mentions").assertDoesNotExist()
        assertEquals(0, sends)
    }

    @Test fun deniedFailedAndLateScopeResultsCannotChangeIam() {
        var devices by mutableStateOf<DeviceMentionSource?>(null)
        var selection = initial
        var picks = 0
        val started = AtomicInteger()
        val denied = DeviceMentionSource(team, load = { catalog }, pick = { picks++; false })
        compose.setContent {
            NuphosTheme {
                CompositionLocalProvider(LocalAgentStore provides store) {
                    Column {
                        Text("Synthetic fixture · failure / read-only / scope")
                        ChatComposer(isStreaming = false, selection = selection,
                            mentions = remember { SessionMentionSource(team) { emptyList() } }, devices = devices, onSend = { error("Must never send") })
                    }
                }
            }
        }
        field().performClick().performTextInput("@fixture")
        compose.onNodeWithText("Computers").assertDoesNotExist()
        compose.runOnIdle { devices = denied }
        compose.waitUntil(5000) { compose.onAllNodesWithText("Fixture Mac").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("…-mac").performScrollTo().performClick()
        field().assertTextEquals("@fixture")
        compose.onNodeWithText("Computer selection unavailable. IAM was not changed.").performScrollTo().assertIsDisplayed()
        snap("synthetic-device-mention-denied")
        compose.runOnIdle { assertEquals(initial, selection); assertEquals(1, picks); devices = DeviceMentionSource(team, { error("Synthetic load failure") }, { error("Must not pick") }) }
        compose.waitUntil(5000) { compose.onAllNodesWithText("Could not load computers. You can keep typing.").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Could not load computers. You can keep typing.").performScrollTo().assertIsDisplayed()
        snap("synthetic-device-mention-error")
        compose.runOnIdle { devices = DeviceMentionSource(team, { started.incrementAndGet(); withContext(NonCancellable) { delay(700); catalog } }, { error("Stale pick") }) }
        compose.waitUntil(5000) { started.get() > 0 }
        compose.runOnIdle { devices = null }
        Thread.sleep(900)
        compose.onNodeWithText("Fixture Mac").assertDoesNotExist()
        compose.runOnIdle { devices = DeviceMentionSource("other-team", { error("Wrong scope must not load") }, { error("Wrong scope must not pick") }) }
        Thread.sleep(250)
        compose.onNodeWithText("Fixture Mac").assertDoesNotExist()
        assertEquals(initial, selection)
    }
}
