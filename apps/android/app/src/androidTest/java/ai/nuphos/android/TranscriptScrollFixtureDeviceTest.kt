package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.model.ChatRow
import ai.nuphos.android.ui.chat.TranscriptList
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class TranscriptScrollFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var state: LazyListState
    private var rows by mutableStateOf(initialRows())
    private var request by mutableStateOf(0)
    private var height by mutableStateOf(600)
    private var inset by mutableStateOf(0)

    private fun initialRows() = (0..34).map { ChatRow.AssistantText("row-$it", "m-$it", "Synthetic history $it\nSecond line\nThird line", false) } + ChatRow.Bottom
    private fun render() {
        compose.setContent {
            NuphosTheme(darkTheme = false) {
                state = rememberLazyListState()
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.windowInsetsPadding(WindowInsets.safeDrawing).padding(16.dp)) {
                        Text("Transcript scroll fixture", style = MaterialTheme.typography.titleLarge)
                        TranscriptList(rows, request, Modifier.height(height.dp).fillMaxWidth(), state, inset.dp) { row ->
                            when (row) {
                                is ChatRow.AssistantText -> Text(row.text)
                                else -> Spacer(Modifier.height(1.dp))
                            }
                        }
                    }
                }
            }
        }
        atBottom()
    }
    private fun atBottom() = compose.waitUntil(10_000) { ::state.isInitialized && !state.canScrollForward && state.layoutInfo.totalItemsCount == rows.size }
    private fun settle() = compose.waitUntil(10_000) { !state.isScrollInProgress }
    private fun scrollUp() {
        compose.onNodeWithTag("transcript-list").performTouchInput { swipeDown() }
        settle()
        compose.onNodeWithContentDescription("Scroll to latest").assertIsDisplayed()
    }
    private fun appendText() {
        compose.runOnIdle {
            val last = rows.filterIsInstance<ChatRow.AssistantText>().last()
            rows = rows.dropLast(2) + last.copy(text = last.text + "\n" + "Streaming line\n".repeat(8), streaming = true) + ChatRow.Bottom
        }
    }
    private fun capture(name: String) {
        compose.waitForIdle()
        val inst = InstrumentationRegistry.getInstrumentation()
        inst.waitForIdleSync()
        android.os.SystemClock.sleep(500)
        File(inst.targetContext.getExternalFilesDir(null), name).outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }
    @Test fun readingOlderContentSurvivesNewRowsAndSameRowStreamingGrowth() {
        render(); scrollUp()
        val before = compose.runOnIdle { state.firstVisibleItemIndex to state.firstVisibleItemScrollOffset }
        appendText()
        compose.runOnIdle { assertEquals(before, state.firstVisibleItemIndex to state.firstVisibleItemScrollOffset) }
        compose.runOnIdle { rows = rows.dropLast(1) + ChatRow.AssistantText("new", "new", "New incoming message", true) + ChatRow.Bottom }
        compose.runOnIdle { assertEquals(before, state.firstVisibleItemIndex to state.firstVisibleItemScrollOffset) }
        capture("timeline-reader-position-light.png")
    }
    @Test fun bottomFollowsSameRowGrowthAndViewportResizeThenCanJumpBack() {
        render(); appendText(); atBottom()
        compose.runOnIdle { height = 360 }; atBottom()
        capture("timeline-stream-follow-light.png")
        scrollUp()
        compose.onNodeWithContentDescription("Scroll to latest").performClick(); atBottom()
        compose.onNodeWithContentDescription("Scroll to latest").assertDoesNotExist()
        appendText(); atBottom()
    }
    @Test fun ownSendRequestReturnsToBottomWithoutChangingHistory() {
        render(); scrollUp()
        val oldRows = rows
        compose.runOnIdle { request++ }; atBottom()
        compose.runOnIdle { assertEquals(oldRows, rows) }
        compose.onNodeWithContentDescription("Scroll to latest").assertDoesNotExist()
    }

    private val listBounds get() = compose.onNodeWithTag("transcript-list").fetchSemanticsNode().boundsInRoot
    private fun lastTextBottom() = compose.onNodeWithText("Synthetic history 34", substring = true).fetchSemanticsNode().boundsInRoot.bottom
    @Test fun theLastRowAndTheButtonStayAboveWhatCoversTheBottom() {
        inset = 120
        render()
        val covered = listBounds.bottom - with(compose.density) { 120.dp.toPx() }
        assertTrue("The last row ends above the cover", lastTextBottom() <= covered)
        scrollUp()
        val button = compose.onNodeWithContentDescription("Scroll to latest").fetchSemanticsNode().boundsInRoot
        assertTrue("The button sits above the cover", button.bottom <= covered)
        assertEquals("12 dp above it", with(compose.density) { 12.dp.toPx() }, covered - button.bottom, 1f)
        compose.onNodeWithContentDescription("Scroll to latest").performClick(); atBottom()
        compose.onNodeWithContentDescription("Scroll to latest").assertDoesNotExist()
        assertTrue("One press reaches the end, clear of the cover", lastTextBottom() <= covered)
    }
    @Test fun aChangingCoverFollowsAtTheEndAndMovesNothingWhileReading() {
        inset = 60
        render()
        compose.runOnIdle { inset = 240 }; compose.waitForIdle(); atBottom()
        val covered = listBounds.bottom - with(compose.density) { 240.dp.toPx() }
        assertTrue("At the end, the last row rises with the cover", lastTextBottom() <= covered)
        scrollUp()
        val before = compose.runOnIdle { state.firstVisibleItemIndex to state.firstVisibleItemScrollOffset }
        compose.runOnIdle { inset = 60 }; compose.waitForIdle()
        compose.runOnIdle { assertEquals(before, state.firstVisibleItemIndex to state.firstVisibleItemScrollOffset) }
        compose.runOnIdle { inset = 300 }; compose.waitForIdle()
        compose.runOnIdle { assertEquals(before, state.firstVisibleItemIndex to state.firstVisibleItemScrollOffset) }
        compose.onNodeWithContentDescription("Scroll to latest").assertIsDisplayed()
    }
    @Test fun aRowAddedWhileReadingIsReachedInOnePress() {
        inset = 120
        render(); scrollUp()
        compose.runOnIdle { rows = rows.dropLast(1) + ChatRow.AssistantText("late", "late", "A late error\n".repeat(6), false) + ChatRow.Bottom }
        compose.waitForIdle()
        compose.onNodeWithContentDescription("Scroll to latest").performClick(); atBottom()
        compose.onNodeWithContentDescription("Scroll to latest").assertDoesNotExist()
        val covered = listBounds.bottom - with(compose.density) { 120.dp.toPx() }
        assertTrue(compose.onNodeWithText("A late error", substring = true).fetchSemanticsNode().boundsInRoot.bottom <= covered)
    }
}
