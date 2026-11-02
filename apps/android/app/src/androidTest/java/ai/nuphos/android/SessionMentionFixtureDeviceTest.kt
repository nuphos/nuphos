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
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.chat.ChatComposer
import ai.nuphos.android.ui.chat.SessionMentionSource
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList

/** Explicit separate install: no real account, data, permissions or network. */
@RunWith(AndroidJUnit4::class)
class SessionMentionFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private lateinit var store: AgentStore
    private val team = "507f1f77bcf86cd799439011"
    private var sends = 0

    @Before fun isolate() {
        assumeTrue("Separate fixture package required", instrumentation.targetContext.packageName in setOf("ai.nuphos.android.mentionfixture", "ai.nuphos.android.contentinput1337"))
        val app = instrumentation.targetContext.applicationContext as NuphosApplication
        assertNull("Fixture must not have credentials", app.tokenStore.read())
        store = AgentStore("synthetic-no-credentials", instrumentation.targetContext)
    }
    @After fun cleanup() { if (::store.isInitialized) store.disposeForConsent() }

    private fun field() = compose.onNodeWithContentDescription("Ask Nuphos anything")
    private fun snap(name: String) {
        compose.waitForIdle()
        val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: error("No screenshot")
        val dir = File(instrumentation.targetContext.filesDir, "mention-synthetic").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    @Test fun selectionCancelEmailMultilineAndThemesNeverSend() {
        var dark by mutableStateOf(false)
        val calls = CopyOnWriteArrayList<String>()
        val source = SessionMentionSource(team, "current") { query ->
            calls += query
            listOf(AgentConversation("current", title = "Current chat"),
                AgentConversation("other", teamId = "wrong", title = "Other team"),
                AgentConversation("synthetic-session", teamId = team, title = "Synthetic project notes")) +
                (1..4).map { AgentConversation("synthetic-$it", teamId = team, title = "Synthetic extra notes $it") }
        }
        compose.setContent {
            NuphosTheme(darkTheme = dark) {
                CompositionLocalProvider(LocalAgentStore provides store, ai.nuphos.android.ui.LocalAuthSession provides (androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as ai.nuphos.android.NuphosApplication).authSession) {
                    Surface(Modifier.fillMaxSize()) {
                        Column(Modifier.fillMaxSize().padding(top = 48.dp)) {
                            Text("Synthetic fixture · no real service data", Modifier.padding(16.dp))
                            Spacer(Modifier.weight(1f))
                            ChatComposer(isStreaming = false, showControls = true, mentions = source, onSend = { sends++; true })
                        }
                    }
                }
            }
        }
        field().performClick().performTextInput("context\n@project")
        compose.waitUntil(5000) { calls.contains("project") }
        compose.onNodeWithText("Synthetic project notes").assertIsDisplayed()
        compose.onNodeWithText("Current chat").assertDoesNotExist()
        compose.onNodeWithText("Other team").assertDoesNotExist()
        compose.onNodeWithContentDescription("Send").assertIsDisplayed()
        compose.onNodeWithContentDescription("Attach").assertIsDisplayed()
        snap("synthetic-mention-light")
        compose.runOnIdle { dark = true }
        snap("synthetic-mention-dark")
        compose.onNodeWithText("Synthetic project notes").performClick()
        field().assertTextEquals("context\nhttps://nuphos.ai/teams/$team/agent/synthetic-session ")
        compose.onNodeWithText("Synthetic project notes").assertDoesNotExist()
        assertEquals(0, sends)
        field().performTextReplacement("email@example.com")
        compose.onNodeWithContentDescription("Dismiss agent mentions").assertDoesNotExist()
        field().performTextReplacement("@")
        compose.onNodeWithContentDescription("Dismiss agent mentions").performClick()
        field().assertTextEquals("@")
        compose.onNodeWithContentDescription("Dismiss agent mentions").assertDoesNotExist()
        val dismissedCalls = calls.size
        field().performTextInput("x")
        Thread.sleep(300)
        compose.onNodeWithContentDescription("Dismiss agent mentions").assertDoesNotExist()
        assertEquals(dismissedCalls, calls.size)
        field().performTextInput(" @again")
        compose.waitUntil(5000) { calls.contains("again") }
        compose.onNodeWithContentDescription("Dismiss agent mentions").assertIsDisplayed()
        assertEquals(0, sends)
    }

    @Test fun lateResponseErrorsEmptyAndTeamChangesCannotInsertStaleResults() {
        var teamId by mutableStateOf(team)
        val calls = CopyOnWriteArrayList<String>()
        compose.setContent {
            val source = remember(teamId) {
                SessionMentionSource(teamId) { query ->
                    calls += "$teamId:$query"
                    when (query) {
                        "slow" -> withContext(NonCancellable) { delay(800); listOf(AgentConversation("late", title = "Stale result")) }
                        "error" -> error("Synthetic search failure")
                        "empty" -> emptyList()
                        else -> listOf(AgentConversation("fresh", title = "Fresh $teamId"))
                    }
                }
            }
            NuphosTheme {
                CompositionLocalProvider(LocalAgentStore provides store, ai.nuphos.android.ui.LocalAuthSession provides (androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as ai.nuphos.android.NuphosApplication).authSession) {
                    ChatComposer(isStreaming = false, showControls = true, mentions = source, onSend = { sends++; true })
                }
            }
        }
        field().performClick().performTextInput("@slow")
        compose.waitUntil(5000) { calls.any { it.endsWith(":slow") } }
        snap("synthetic-mention-loading")
        field().performTextReplacement("@empty")
        compose.waitUntil(5000) { calls.any { it.endsWith(":empty") } }
        compose.onNodeWithText("No matching agents").assertIsDisplayed()
        snap("synthetic-mention-empty")
        // Wait beyond the deliberately non-cooperative old request.
        compose.waitUntil(5000) { compose.onAllNodesWithText("Searching agents…").fetchSemanticsNodes().isEmpty() }
        Thread.sleep(900)
        compose.onNodeWithText("Stale result").assertDoesNotExist()
        field().performTextReplacement("@error")
        compose.waitUntil(5000) { calls.any { it.endsWith(":error") } }
        compose.onNodeWithText("Could not search agents. You can keep typing.").assertIsDisplayed()
        snap("synthetic-mention-error")
        field().performTextReplacement("@next")
        compose.waitUntil(5000) { calls.any { it.endsWith(":next") } }
        compose.onNodeWithText("Fresh $team").assertIsDisplayed()
        compose.runOnIdle { teamId = "507f1f77bcf86cd799439012" }
        compose.onNodeWithText("Fresh $team").assertDoesNotExist()
        compose.waitUntil(5000) { calls.contains("507f1f77bcf86cd799439012:next") }
        compose.onNodeWithText("Fresh 507f1f77bcf86cd799439012").performClick()
        field().assertTextEquals("https://nuphos.ai/teams/507f1f77bcf86cd799439012/agent/fresh ")
        assertEquals(0, sends)
    }
}
