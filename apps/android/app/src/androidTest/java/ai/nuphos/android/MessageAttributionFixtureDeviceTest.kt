package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.model.*
import ai.nuphos.android.ui.chat.AgentEventRow
import ai.nuphos.android.ui.chat.MessageImages
import ai.nuphos.android.ui.chat.MessageSenderLabel
import ai.nuphos.android.ui.chat.UserMessageContent
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Synthetic UI only; no auth, transport, microphone or production activity. */
@RunWith(AndroidJUnit4::class)
class MessageAttributionFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private fun render() {
        compose.setContent {
            NuphosTheme(darkTheme = false) {
                Surface {
                    Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Message attribution fixture", style = MaterialTheme.typography.titleLarge)
                        MessageSenderLabel(MessageAttribution("token", "Test Bot", "agent", "nuphos", "Can"))
                        Text("A token message stays a message.")
                        AgentEventRow(ChatRow.Event("event", ChatRow.User("event-content", "event-message",
                            "CI completed\nFull event details stay readable.", emptyList(),
                            sender = MessageAttribution("github", "GitHub", "system", "agent.resource"))), {}) {
                            Text("Fixture attachment preserved")
                        }
                        AgentEventRow(ChatRow.Event("thread", ChatRow.User("thread-content", "thread-message",
                            "Android checks finished\nThe source session supplied this update.", emptyList(),
                            sender = MessageAttribution("session", "Android Agent", "agent", "agent.thread"))), {})
                        Text("An ordinary user message stays ordinary.")
                    }
                }
            }
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
    @Test fun compactEventsExpandWithoutHidingAttributionOrAttachments() {
        render()
        compose.onNodeWithText("Test Bot · via Can").assertIsDisplayed()
        compose.onNodeWithText("Full event details stay readable.", substring = true).assertDoesNotExist()
        capture("attribution-collapsed-light.png")
        compose.onNodeWithText("CI completed").performClick()
        compose.onNodeWithText("Fixture attachment preserved").assertIsDisplayed()
        compose.onNodeWithText("Full event details stay readable.", substring = true).assertExists()
        capture("attribution-expanded-light.png")
        compose.onNodeWithContentDescription("Collapse event").performClick()
        compose.onNodeWithText("Fixture attachment preserved").assertDoesNotExist()
        compose.onNodeWithText("Android checks finished").assertIsDisplayed()
    }

    private fun image(): String {
        val bitmap = Bitmap.createBitmap(200, 200, Bitmap.Config.ARGB_8888)
        val bytes = java.io.ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        return "data:image/png;base64," + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
    }
    private val me = MessageAttribution("me", "Can Yu", "user", "nuphos")
    private fun message(sender: MessageAttribution?, text: String, images: Int = 0, width: Int = 400) {
        val sources = List(images) { image() }
        compose.setContent {
            NuphosTheme(darkTheme = false) {
                Surface {
                    Box(Modifier.width(width.dp).testTag("message")) {
                        UserMessageContent(sender, text) { MessageImages(sources, "message", alignEnd = true) }
                    }
                }
            }
        }
        if (images > 0) compose.waitUntil(5_000) {
            compose.onAllNodesWithContentDescription("Image 1 of $images", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        }
        compose.waitForIdle()
    }
    private fun tag(name: String) = compose.onNodeWithTag(name, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
    private fun picture(index: Int, count: Int) =
        compose.onNodeWithContentDescription("Image $index of $count", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
    private fun assertGap(above: androidx.compose.ui.geometry.Rect, below: androidx.compose.ui.geometry.Rect) {
        assertEquals(with(compose.density) { 6.dp.toPx() }, below.top - above.bottom, 1f)
    }

    @Test fun senderAndTextAreSixDpApart() {
        message(me, "Please check this.")
        assertGap(tag("message-sender"), tag("user-bubble"))
    }
    @Test fun aLongSenderNameKeepsTheGap() {
        message(MessageAttribution("me", "A very long sender name that needs more than one line to fit in this message", "user", "nuphos"), "Hi")
        assertGap(tag("message-sender"), tag("user-bubble"))
    }
    @Test fun senderImagesAndTextAreSixDpApart() {
        message(me, "With pictures.", images = 2)
        assertGap(tag("message-sender"), picture(1, 2))
        assertEquals("Side by side", picture(1, 2).top, picture(2, 2).top, 1f)
        assertEquals(with(compose.density) { 6.dp.toPx() }, picture(2, 2).left - picture(1, 2).right, 1f)
        assertEquals("Against the right edge", tag("message").right, picture(2, 2).right, 1f)
        assertGap(picture(2, 2), tag("user-bubble"))
    }
    @Test fun onlyImagesLeaveNoSpaceBelowThem() {
        message(me, "", images = 1)
        assertGap(tag("message-sender"), picture(1, 1))
        assertEquals(picture(1, 1).bottom, tag("message").bottom, 1f)
    }
    @Test fun withoutASenderThereIsNoSpaceAbove() {
        message(null, "No sender.")
        compose.onAllNodesWithTag("message-sender", useUnmergedTree = true).assertCountEquals(0)
        assertEquals(tag("message").top, tag("user-bubble").top, 1f)
        assertEquals(tag("message").bottom, tag("user-bubble").bottom, 1f)
    }
    @Test fun imagesThatDontFitWrapInsideTheMessage() {
        // 96 dp images: 4 need 402 dp, so 300 dp fits three and wraps the fourth.
        message(me, "Four pictures.", images = 4, width = 300)
        val box = tag("message")
        (1..4).forEach { assertTrue("Image $it stays inside", picture(it, 4).left >= box.left - 1f && picture(it, 4).right <= box.right + 1f) }
        assertEquals("Three fit on the first line", picture(1, 4).top, picture(3, 4).top, 1f)
        assertGap(picture(3, 4), picture(4, 4))
        assertEquals("The last line stays on the right", box.right, picture(4, 4).right, 1f)
        assertGap(picture(4, 4), tag("user-bubble"))
    }
    @Test fun aNarrowMessageStacksTheImages() {
        message(me, "", images = 3, width = 120)
        assertGap(picture(1, 3), picture(2, 3))
        assertGap(picture(2, 3), picture(3, 3))
        assertEquals(tag("message").right, picture(3, 3).right, 1f)
    }
    @Test fun moreThanFourShowsTheCount() {
        message(me, "", images = 6)
        compose.onNodeWithText("+2").assertExists()
        compose.onAllNodesWithContentDescription("Image 5 of 6", useUnmergedTree = true).assertCountEquals(0)
    }
}
