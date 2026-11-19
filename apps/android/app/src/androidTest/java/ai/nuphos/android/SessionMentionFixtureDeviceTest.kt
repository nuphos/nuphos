package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
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
        val app = instrumentation.targetContext.applicationContext as NuphosApplication
        assertNull("Fixture must not have credentials", app.tokenStore.read())
        store = AgentStore("synthetic-no-credentials", instrumentation.targetContext)
    }
    @After fun cleanup() { if (::store.isInitialized) store.disposeForConsent() }

    private fun field() = compose.onNodeWithContentDescription("Ask Nuphos anything")
    private fun snap(name: String) {
        compose.waitForIdle()
        val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: error("No screenshot")
        // The run's additional output, so the captures land in the CI artifact.
        val dir = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")?.let(::File)
            ?: File(instrumentation.targetContext.filesDir, "mention-synthetic")
        dir.mkdirs()
        File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    /** Every `@` opens on what was listed before it, and typing on only narrows it (#3739). */
    @Test fun atOpensOnWhatWasListedAndTypingReadsNothing() {
        val reads = java.util.concurrent.atomic.AtomicInteger()
        // No parameter named: the same source reads for an `@` or as the composer appears.
        val source = SessionMentionSource(team, "current") {
            reads.incrementAndGet()
            listOf(AgentConversation("synthetic-session", teamId = team, title = "Synthetic project notes"),
                AgentConversation("synthetic-other", teamId = team, title = "Synthetic deploy log"))
        }
        compose.setContent {
            NuphosTheme {
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
        field().performClick()
        compose.waitForIdle()
        Thread.sleep(500)
        val listed = reads.get()
        field().performTextInput("@")
        compose.onNodeWithText("Synthetic project notes").assertIsDisplayed()
        compose.onNodeWithText("Synthetic deploy log").assertIsDisplayed()
        snap("synthetic-mention-at-once")
        field().performTextInput("p")
        field().performTextInput("r")
        field().performTextInput("o")
        compose.onNodeWithText("Synthetic project notes").assertIsDisplayed()
        compose.onNodeWithText("Synthetic deploy log").assertDoesNotExist()
        Thread.sleep(500)
        compose.waitForIdle()
        snap("synthetic-mention-narrowed")
        assertEquals("Typing read the server again", listed, reads.get())
        assertEquals(0, sends)
    }

    @Test fun selectionCancelEmailMultilineAndThemesNeverSend() {
        var dark by mutableStateOf(false)
        val calls = CopyOnWriteArrayList<String>()
        val source = SessionMentionSource(team, "current") {
            calls += "list"
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
        compose.waitUntil(5000) { compose.onAllNodesWithText("Synthetic project notes").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Synthetic project notes").assertIsDisplayed()
        compose.onNodeWithText("Current chat").assertDoesNotExist()
        compose.onNodeWithText("Other team").assertDoesNotExist()
        compose.onNodeWithContentDescription("Send").assertIsDisplayed()
        compose.onNodeWithContentDescription("Photos").assertIsDisplayed()
        snap("synthetic-mention-light")
        compose.runOnIdle { dark = true }
        snap("synthetic-mention-dark")
        compose.onNodeWithText("Synthetic project notes").performClick()
        field().assertTextEquals("context\n@Synthetic project notes ")
        compose.onNodeWithText("Synthetic project notes").assertDoesNotExist()
        assertEquals(0, sends)
        field().performTextReplacement("email@example.com")
        compose.onNodeWithContentDescription("Dismiss task mentions").assertDoesNotExist()
        field().performTextReplacement("@")
        compose.onNodeWithContentDescription("Dismiss task mentions").performClick()
        field().assertTextEquals("@")
        compose.onNodeWithContentDescription("Dismiss task mentions").assertDoesNotExist()
        val dismissedCalls = calls.size
        field().performTextInput("x")
        Thread.sleep(300)
        compose.onNodeWithContentDescription("Dismiss task mentions").assertDoesNotExist()
        assertEquals(dismissedCalls, calls.size)
        field().performTextInput(" @again")
        compose.onNodeWithContentDescription("Dismiss task mentions").assertIsDisplayed()
        assertEquals(0, sends)
    }

    @Test fun failedEmptyLateAndTeamChangedListingsCannotInsertStaleResults() {
        var teamId by mutableStateOf(team)
        var mode by mutableStateOf("error")
        val other = "507f1f77bcf86cd799439012"
        compose.setContent {
            val source = remember(teamId, mode) {
                SessionMentionSource(teamId) {
                    when (mode) {
                        "slow" -> withContext(NonCancellable) { delay(800); listOf(AgentConversation("late", title = "Stale result")) }
                        "error" -> error("Synthetic list failure")
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
        field().performClick().performTextInput("@")
        compose.waitUntil(5000) { compose.onAllNodesWithText("Could not search tasks. You can keep typing.").fetchSemanticsNodes().isNotEmpty() }
        snap("synthetic-mention-error")
        compose.runOnIdle { mode = "empty" }
        compose.waitUntil(5000) { compose.onAllNodesWithText("No matching tasks").fetchSemanticsNodes().isNotEmpty() }
        snap("synthetic-mention-empty")
        compose.runOnIdle { mode = "slow" }
        compose.onNodeWithText("Searching tasks…").assertIsDisplayed()
        snap("synthetic-mention-loading")
        // Another workspace before the late listing answers: its rows never show here.
        compose.runOnIdle { teamId = other; mode = "fresh" }
        compose.waitUntil(5000) { compose.onAllNodesWithText("Fresh $other").fetchSemanticsNodes().isNotEmpty() }
        Thread.sleep(900)
        compose.onNodeWithText("Stale result").assertDoesNotExist()
        compose.onNodeWithText("Fresh $other").performClick()
        field().assertTextEquals("@Fresh $other ")
        assertEquals(0, sends)
    }
}
