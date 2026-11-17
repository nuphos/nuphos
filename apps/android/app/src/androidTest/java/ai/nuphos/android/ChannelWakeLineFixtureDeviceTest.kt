package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.ChatRow
import ai.nuphos.android.model.MessageAttribution
import ai.nuphos.android.ui.chat.AgentEventRow
import ai.nuphos.android.ui.theme.NuphosTheme
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Synthetic UI only: a channel's wake-up on a Task names its newest post in one line that opens the channel. */
@RunWith(AndroidJUnit4::class)
class ChannelWakeLineFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()

    private fun capture(name: String) {
        compose.waitForIdle()
        val inst = InstrumentationRegistry.getInstrumentation()
        inst.waitForIdleSync()
        File(inst.targetContext.getExternalFilesDir(null), name).outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test fun wakeLineNamesTheNewestPost() {
        val sender = MessageAttribution.parse(JsonValue.parse(
            """{"version":1,"source":"agent.resource","sentAt":"2026-11-16T05:12:00Z","sender":{"id":"channel:c-launch","type":"system","displayName":"launch-review"},
               "channelPost":{"id":"p1","text":"Staging deploy failed on the migrations step, can you look?","more":2,"sender":{"type":"user","id":"u1","displayName":"Mei Chen"}}}"""))
        val row = ChatRow.Event("wake", ChatRow.User("wake", "wake", "New messages in a Nuphos channel (channelId c-launch).", emptyList(), sender = sender))
        val opened = mutableListOf<String>()
        compose.setContent {
            NuphosTheme(darkTheme = false) {
                Surface {
                    Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Done: the migration now runs before the seed step.")
                        AgentEventRow(row, onLink = {}, onOpenChannel = { opened += it })
                        Text("Looking at the failed step now.")
                    }
                }
            }
        }
        capture("channel-wake-line-light.png")
        compose.onNodeWithText("Mei Chen").assertIsDisplayed()
        compose.onNodeWithText("+2 more").assertIsDisplayed()
        compose.onNodeWithTag("channel-notice").assertHeightIsAtLeast(44.dp).performClick()
        assertEquals(listOf("c-launch"), opened)
    }
}
