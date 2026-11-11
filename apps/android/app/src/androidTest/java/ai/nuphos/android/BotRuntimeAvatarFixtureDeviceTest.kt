package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.model.BotFaces
import ai.nuphos.android.model.ChatFace
import ai.nuphos.android.ui.chats.ChatIcon
import ai.nuphos.android.ui.components.AgentAvatar
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Synthetic shared-group component capture; real screen ancestor capture is separate. */
@RunWith(AndroidJUnit4::class)
class BotRuntimeAvatarFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val first = "synthetic-avatar-first"
    private val second = "synthetic-avatar-second"
    @After fun clearFaces() { BotFaces.learn(first, null); BotFaces.learn(second, null) }

    @Test fun frontRearAndTwoBotBadgesSurviveProviderChanges() {
        var provider by mutableStateOf<String?>("codex")
        BotFaces.learn(first, "02-leonardo"); BotFaces.learn(second, "07-ada")
        compose.setContent {
            NuphosTheme(darkTheme = false) { Surface(Modifier.fillMaxSize()) {
                Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    val bot = ChatFace(first, "Bot", agent = ChatFace.Agent("02-leonardo", provider))
                    val other = ChatFace(second, "Other Bot", agent = ChatFace.Agent("07-ada", "grok"))
                    val human = ChatFace("human", "Human")
                    for (size in listOf(22.dp, 44.dp)) {
                        Text("Group $size")
                        Row(horizontalArrangement = Arrangement.spacedBy(36.dp)) {
                            Box(Modifier.testTag("rear-$size")) { ChatIcon(listOf(human, bot), "Rear Bot", size) }
                            Box(Modifier.testTag("front-$size")) { ChatIcon(listOf(bot, human), "Front Bot", size) }
                            Box(Modifier.testTag("pair-$size")) { ChatIcon(listOf(bot, other), "Two Bots", size) }
                            Box(Modifier.testTag("human-$size")) { ChatIcon(listOf(human, ChatFace("other-human", "Other")), "People", size) }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                        for (size in listOf(14.dp, 20.dp, 24.dp, 36.dp)) AgentAvatar(first, provider, size)
                    }
                    Button(onClick = { provider = when (provider) { "codex" -> "grok"; "grok" -> null; else -> "codex" } }) { Text("Switch runtime") }
                }
            } }
        }
        // 4 group marks per size + 4 single-avatar marks. Humans receive none.
        compose.onAllNodesWithTag("runtime-provider-mark", useUnmergedTree = true).assertCountEquals(12)
        repeat(3) { compose.onNodeWithText("Switch runtime").performClick() }
        capture("01-codex-and-grok")
        compose.onNodeWithText("Switch runtime").performClick()
        capture("02-same-bot-grok")
        compose.onNodeWithText("Switch runtime").performClick()
        capture("03-same-bot-missing-runtime")
        compose.onAllNodesWithTag("runtime-provider-mark", useUnmergedTree = true).assertCountEquals(12)
    }

    private fun capture(name: String) {
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.waitForIdleSync()
        Thread.sleep(300) // Let the actual platform window draw after the Compose frame.
        val image = instrumentation.uiAutomation.takeScreenshot() ?: error("No synthetic screenshot")
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "review-bot-runtime-avatar").apply { mkdirs() }
        File(directory, "$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        image.recycle()
    }
}
