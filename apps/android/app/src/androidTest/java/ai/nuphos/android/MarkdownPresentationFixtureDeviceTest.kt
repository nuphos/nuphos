package ai.nuphos.android

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import ai.nuphos.android.ui.components.MarkdownText
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Synthetic Markdown only. This fixture does not read or change account data. */
class MarkdownPresentationFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val hint = "Swipe horizontally to see more columns"
    private val completeValue = "Complete instance name with enough words to wrap onto multiple lines"
    private val table = """
        | Instance | State | Region | Notes |
        | --- | --- | --- | --- |
        | $completeValue | Running | Fixture region | Final column value |
    """.trimIndent()

    private fun awaitText(value: String) {
        compose.waitUntil(5_000) {
            compose.onAllNodesWithText(value, substring = true, useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun assertFullValue(value: String) {
        val layouts = mutableListOf<TextLayoutResult>()
        compose.onNodeWithText(value, substring = true, useUnmergedTree = true)
            .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { assertTrue(it(layouts)) }
        assertTrue("The cell must wrap instead of truncating", layouts.single().lineCount > 1)
        assertFalse("The complete value must fit in the cell", layouts.single().hasVisualOverflow)
        assertFalse("The last line must not be ellipsized", layouts.single().isLineEllipsized(layouts.single().lineCount - 1))
    }

    @Test fun wideTableShowsHintWrapsCompleteCellsAndScrollsToLastColumn() {
        compose.setContent { NuphosTheme { Box(Modifier.width(300.dp).testTag("table-viewport")) { MarkdownText(table) } } }
        awaitText(completeValue)
        compose.onNodeWithText(hint).assertIsDisplayed()
        assertFullValue(completeValue)
        repeat(2) { compose.onNode(hasScrollAction()).performTouchInput { swipeLeft() } }
        val lastCell = compose.onNodeWithText("Final column value", substring = true).assertIsDisplayed()
        val viewport = compose.onNodeWithTag("table-viewport").fetchSemanticsNode().boundsInRoot
        val cellBounds = lastCell.fetchSemanticsNode().boundsInRoot
        assertTrue("The last cell must be fully visible after horizontal scrolling", cellBounds.left >= viewport.left && cellBounds.right <= viewport.right)
    }

    @Test fun streamingTableKeepsCompleteValuesAfterAppendAndReplacement() {
        val text = mutableStateOf(table.substringBefore("| $completeValue"))
        compose.setContent { NuphosTheme { Box(Modifier.width(300.dp)) { MarkdownText(text.value, streaming = true) } } }
        compose.runOnIdle { text.value = table }
        awaitText(completeValue)
        assertFullValue(completeValue)
        val replacement = "Replacement instance name that still needs several wrapped lines"
        compose.runOnIdle { text.value = table.replace(completeValue, replacement) }
        awaitText(replacement)
        assertFullValue(replacement)
        compose.onNodeWithText(completeValue, substring = true).assertDoesNotExist()
        compose.onNodeWithText(hint).assertIsDisplayed()
    }

    @Test fun tableLinkStillDispatchesThroughCallerHandler() {
        val opened = mutableListOf<String>()
        val content = "| Link | State | Region | Notes |\n| --- | --- | --- | --- |\n| [Open docs](https://example.com/docs) | Running | Fixture | None |"
        compose.setContent { NuphosTheme { Box(Modifier.width(300.dp)) { MarkdownText(content, onLink = { opened += it }) } } }
        awaitText("Open docs")
        val link = compose.onNodeWithText("Open docs", substring = true, useUnmergedTree = true)
        val layouts = mutableListOf<TextLayoutResult>()
        link.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { assertTrue(it(layouts)) }
        val glyph = layouts.single().getBoundingBox(layouts.single().layoutInput.text.text.indexOf("Open docs"))
        link.performTouchInput { click(Offset(glyph.center.x, glyph.center.y)) }
        compose.runOnIdle { assertEquals(listOf("https://example.com/docs"), opened) }
    }

    @Test fun tableThatFitsHasNoSwipeHint() {
        compose.setContent { NuphosTheme { Box(Modifier.width(300.dp)) { MarkdownText("| Name |\n| --- |\n| Fixture |") } } }
        awaitText("Fixture")
        compose.onNodeWithText(hint).assertDoesNotExist()
    }

    @Test fun ordinaryParagraphHasNoTableSwipeHint() {
        compose.setContent { NuphosTheme { MarkdownText("Plain paragraph") } }
        awaitText("Plain paragraph")
        compose.onNodeWithText(hint).assertDoesNotExist()
    }
}
