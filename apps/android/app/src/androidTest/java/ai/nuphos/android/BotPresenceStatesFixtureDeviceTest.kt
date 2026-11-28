package ai.nuphos.android

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.model.BotPresence
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.ui.chats.ChannelMembersSheet
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Synthetic Bots only (#3308): a group chat's Bots sheet shows each of the six presence states. */
@RunWith(AndroidJUnit4::class)
class BotPresenceStatesFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val dark = InstrumentationRegistry.getArguments().getString("darkTheme") == "true"

    @Test fun eachStateHasItsWord() {
        val agents = listOf(
            ChannelAgent("bot-1", "Atlas", avatar = "02-leonardo", presence = BotPresence("online")),
            ChannelAgent("bot-2", "Scribe", avatar = "07-ada", presence = BotPresence("busy")),
            ChannelAgent("bot-3", "Vermeer", avatar = "01-vermeer-girl", presence = BotPresence("offline", "computer_offline")),
            ChannelAgent("bot-4", "Frida", avatar = "09-frida", presence = BotPresence("offline", "sign_in_required")),
            ChannelAgent("bot-5", "Newton", avatar = "12-newton", presence = BotPresence("offline", "usage_limit", "2026-11-18T18:00:00.000Z")),
            ChannelAgent("bot-6", "Mozart", avatar = "11-mozart", presence = BotPresence("offline", "runtime_deleted")),
        )
        agents.forEach { ai.nuphos.android.model.BotFaces.learn(it.sessionId, it.avatar) }
        val members = ai.nuphos.android.session.ChannelMembers(ChannelMembersFixtureDeviceTest.Fake(listOf(ChannelMembersFixtureDeviceTest.jordan)), "jordan")
        compose.setContent { NuphosTheme(darkTheme = dark) { ChannelMembersSheet(members, "Launch review", agents, "jordan") {} } }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("member-row").fetchSemanticsNodes().size == 6 }
        for (word in listOf("Online", "Busy", "Offline", "Needs sign-in", "Out of usage", "Unavailable"))
            compose.onNodeWithText(word).assertIsDisplayed()
        compose.waitForIdle()
        val dir = inst.targetContext.getExternalFilesDir("presence")!!
        java.io.File(dir, "presence-states-${if (dark) "dark" else "light"}.png").outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }
}
