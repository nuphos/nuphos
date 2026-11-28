package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.AgentChatApi
import ai.nuphos.android.data.GeneralAccess
import ai.nuphos.android.data.SessionAccess
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.BotPresence
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.model.TeamMember
import ai.nuphos.android.session.ChannelMembers
import ai.nuphos.android.ui.chats.ChannelMembersSheet
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList

/** A group chat's Members (#5313) against a synthetic chat: no account, network or preference. */
@RunWith(AndroidJUnit4::class)
class ChannelMembersFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()

    /** The server's rules for the chat's people and Bots, kept in memory. */
    class Fake(var people: List<SessionAccess.Participant>, private val team: List<TeamMember> = emptyList()) : ChannelMembers.Transport {
        val calls = CopyOnWriteArrayList<String>()
        @Volatile var failures = 0
        private fun call(name: String) {
            calls += name
            if (failures > 0) { failures--; throw AgentChatApi.conflict(500, """{"error":{"message":"Synthetic failure"}}""") }
        }
        private fun access() = SessionAccess(GeneralAccess.Invited, people)
        override suspend fun read() = access()
        override suspend fun members() = team
        override suspend fun general(value: GeneralAccess) = error("Not in this fixture")
        override suspend fun invite(userId: String, grantComputerUse: Boolean): SessionAccess {
            call("invite $userId $grantComputerUse")
            if (!grantComputerUse) throw AgentChatApi.conflict(409, """{"error":{"code":"computer_use_required","message":"Also give use of this computer?"}}""")
            val member = team.first { it.id == userId }
            people = people + SessionAccess.Participant(member.id, member.name, member.email, isOwner = false, role = "reply")
            return access()
        }
        // An owner leaving hands the chat to the next person; the last one leaving archives it.
        override suspend fun remove(userId: String): SessionAccess {
            call("remove $userId")
            val gone = people.first { it.id == userId }
            people = (people - gone).let { rest -> if (gone.isOwner && rest.isNotEmpty()) listOf(rest[0].copy(isOwner = true, role = "owner")) + rest.drop(1) else rest }
            return access()
        }
        override suspend fun addBot(botId: String) = call("addBot $botId")
        override suspend fun removeBot(botId: String) = call("removeBot $botId")
    }

    companion object {
        fun person(id: String, name: String, owner: Boolean = false) =
            SessionAccess.Participant(id, name, "$id@acme.example", owner, if (owner) "owner" else "reply")
        val jordan = person("jordan", "Jordan Lee", owner = true)
        val riley = person("riley", "Riley Chen")
        val sam = person("sam", "Sam Park")
        val agents = listOf(
            ChannelAgent("bot-planner", "Launch planner", ownerId = "sam", provider = "claude", avatar = "01-vermeer-girl", presence = BotPresence("online")),
            ChannelAgent("bot-critic", "Design Critic", ownerId = "riley", provider = "codex", avatar = "07-ada", presence = BotPresence("online")),
        )
        val team = listOf(TeamMember("taylor", "Taylor Kim", "taylor@acme.example"), TeamMember("morgan", "Morgan Diaz", "morgan@acme.example"),
            TeamMember("casey", "Casey Wong", "casey@acme.example"))
        val yourBots = listOf(AgentConversation("bot-support", title = "Support Lead", agentRuntime = "claude", avatar = "05-rembrandt"),
            AgentConversation("bot-docs", title = "Docs Writer", agentRuntime = "codex", avatar = "09-frida"),
            AgentConversation("bot-sre", title = "SRE On-call", agentRuntime = "codex", avatar = "12-newton"))
    }

    private val inst = InstrumentationRegistry.getInstrumentation()
    @Volatile private var left = 0

    private fun show(fake: Fake, viewer: String): ChannelMembers {
        agents.forEach { ai.nuphos.android.model.BotFaces.learn(it.sessionId, it.avatar) }
        yourBots.forEach { ai.nuphos.android.model.BotFaces.learn(it.sessionId, it.avatar) }
        val members = ChannelMembers(fake, viewer)
        compose.setContent {
            NuphosTheme(darkTheme = false) {
                ChannelMembersSheet(members, "Launch review", agents, viewer, yourBots, teamName = "Acme Inc.", onLeft = { left++ }) {}
            }
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("person-row").fetchSemanticsNodes().size == fake.people.size }
        return members
    }
    private fun has(text: String) = compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
    private fun waitFor(text: String) = compose.waitUntil(10_000) { has(text) }

    /** Each board's screen, uploaded with the device test report for the PR's comparison. */
    private fun capture(name: String) {
        compose.waitForIdle()
        Thread.sleep(600)
        val bitmap = inst.uiAutomation.takeScreenshot() ?: return
        val app = inst.targetContext.applicationContext
        val dir = File(app.externalMediaDirs.first(), "additional_test_output").apply { mkdirs() }
        File(dir, "members-$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }

    @Test fun theOwnerAddsABot() {
        val fake = Fake(listOf(jordan, riley, sam))
        show(fake, "jordan")
        // The owner sees both Bots' menus, everyone's but their own, and Add people.
        compose.onNodeWithText("Members").assertIsDisplayed()
        compose.onNodeWithText("Jordan Lee (you)").assertIsDisplayed()
        compose.onNodeWithText("Owner").assertIsDisplayed()
        assertEquals(4, compose.onAllNodes(hasContentDescription("More options for", substring = true)).fetchSemanticsNodes().size)
        compose.onNodeWithText("Add people").assertIsDisplayed()
        capture("A2")
        compose.onNodeWithText("Add Bot").performClick()
        waitFor("Your Bots")
        compose.onNodeWithText("Adding your Bot lets everyone here talk to it. Anything that needs approval still waits for you in its own chat.").assertIsDisplayed()
        capture("A4")
        compose.onNodeWithContentDescription("Add Support Lead").performClick()
        // Added, it goes back to the chat's Members.
        waitFor("People")
        assertEquals(listOf("addBot bot-support"), fake.calls.toList())
    }

    @Test fun theOwnerAddsAPersonAfterTheComputerQuestion() {
        val fake = Fake(listOf(jordan, riley, sam), team)
        show(fake, "jordan")
        compose.onNodeWithText("Add people").performClick()
        waitFor("taylor@acme.example")
        compose.onNodeWithText("Acme Inc.").assertIsDisplayed()
        capture("A5")
        compose.onNodeWithContentDescription("Add Taylor Kim").performClick()
        waitFor("Also give use of this computer?")
        compose.onNodeWithText("Continue").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("person-row").fetchSemanticsNodes().size == 4 }
        compose.onNodeWithText("Taylor Kim").assertIsDisplayed()
        assertEquals(listOf("invite taylor false", "invite taylor true"), fake.calls.toList())
    }

    @Test fun aMemberLeaves() {
        val fake = Fake(listOf(jordan, riley, sam))
        show(fake, "sam")
        // Not the owner: no menus on people, a note instead of Add people, and only their own Bot's menu.
        compose.onNodeWithText("Sam Park (you)").assertIsDisplayed()
        compose.onNodeWithText("Only the owner can add people.").assertIsDisplayed()
        compose.onNodeWithText("Add people").assertDoesNotExist()
        compose.onNodeWithContentDescription("More options for Launch planner").assertIsDisplayed()
        assertEquals(1, compose.onAllNodes(hasContentDescription("More options for", substring = true)).fetchSemanticsNodes().size)
        capture("A3")
        compose.onNodeWithText("Leave chat").performClick()
        compose.onNodeWithText("You can come back only if someone adds you.").assertIsDisplayed()
        compose.onNodeWithText("Leave").performClick()
        compose.waitUntil(10_000) { left == 1 }
        assertEquals(listOf("remove sam"), fake.calls.toList())
    }

    @Test fun theOwnerLeavesAndTheNextPersonOwnsIt() {
        val fake = Fake(listOf(jordan, riley, sam))
        show(fake, "jordan")
        compose.onNodeWithText("Leave chat").performClick()
        compose.onNodeWithText("Leave “Launch review”?").assertIsDisplayed()
        compose.onNodeWithText("Riley Chen becomes the owner. You can come back only if someone adds you.").assertIsDisplayed()
        capture("A6")
        compose.onNodeWithText("Leave").performClick()
        compose.waitUntil(10_000) { left == 1 }
        assertEquals(listOf("remove jordan"), fake.calls.toList())
        assertTrue(fake.people.first { it.id == "riley" }.isOwner)
    }

    @Test fun theLastPersonLeavesAndTheChatIsArchived() {
        val fake = Fake(listOf(jordan))
        show(fake, "jordan")
        compose.onNodeWithText("Leave chat").performClick()
        compose.onNodeWithText("You’re the last one here, so the chat is archived.").assertIsDisplayed()
        compose.onNodeWithText("Leave").performClick()
        compose.waitUntil(10_000) { left == 1 }
        assertTrue(fake.people.isEmpty())
    }

    @Test fun aFailedLeaveSaysSoAndRetries() {
        val fake = Fake(listOf(jordan, riley, sam)).apply { failures = 1 }
        show(fake, "jordan")
        compose.onNodeWithText("Leave chat").performClick()
        compose.onNodeWithText("Leave").performClick()
        waitFor("Couldn’t leave the chat")
        assertEquals(0, left)
        capture("A8")
        compose.onNodeWithText("Retry").performClick()
        compose.waitUntil(10_000) { left == 1 }
        assertEquals(listOf("remove jordan", "remove jordan"), fake.calls.toList())
    }
}
