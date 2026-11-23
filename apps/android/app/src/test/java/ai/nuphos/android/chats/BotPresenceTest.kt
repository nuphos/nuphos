package ai.nuphos.android.chats

import ai.nuphos.android.data.Http
import ai.nuphos.android.model.BotPresence
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.model.ChannelAgentsEnvelope
import org.junit.Assert.*
import org.junit.Test

/** A chat reads each Bot's presence from its agents, as Desktop does (#3308). */
class BotPresenceTest {
    private fun agent(id: String, name: String, presence: String?) = Http.json.decodeFromString<ChannelAgent>(
        """{"sessionId":"$id","title":"$name"${presence?.let { ",\"presence\":$it" } ?: ""}}""")

    private val online = """{"state":"online"}"""
    private val offline = """{"state":"offline","reason":"computer_offline"}"""

    @Test fun theChatsAgentsCarryTheirPresenceAsTheServerSendsIt() {
        val listed = Http.json.decodeFromString<ChannelAgentsEnvelope>("""{"agents":[
            {"sessionId":"a","title":"Atlas","presence":{"state":"busy"}},
            {"sessionId":"b","title":"Scribe","presence":{"state":"offline","reason":"usage_limit","resetsAt":"2026-11-18T18:00:00.000Z"}},
            {"sessionId":"c","title":"Old"}]}""").agents
        assertEquals(BotPresence("busy"), listed[0].presence)
        assertEquals(BotPresence("offline", "usage_limit", "2026-11-18T18:00:00.000Z"), listed[1].presence)
        assertNull("A server without presence lists the agent all the same", listed[2].presence)
    }

    @Test fun aGroupChatNamesTheBotWhoseComputerIsOffline() {
        val agents = listOf(agent("a", "Atlas", online), agent("b", "Scribe", offline))
        assertEquals("Scribe’s computer is offline.", ChannelAgent.offlineStrip(agents, botId = null))
    }

    @Test fun aBotsOwnChatShowsTheTasksOfflineStrip() {
        assertEquals("The computer running this runtime is offline. Open Nuphos on it, or switch to another runtime.",
            ChannelAgent.offlineStrip(listOf(agent("b", "Scribe", offline)), botId = "b"))
    }

    @Test fun theMemberListShowsEachStateWithDesktopsWordAndColour() {
        val green = BotPresence.Tone.Ready; val amber = BotPresence.Tone.Waiting; val red = BotPresence.Tone.Down
        assertEquals(green to "Online", BotPresence("online").tag)
        assertEquals(green to "Busy", BotPresence("busy").tag)
        assertEquals(red to "Offline", BotPresence("offline", "computer_offline").tag)
        assertEquals(amber to "Needs sign-in", BotPresence("offline", "sign_in_required").tag)
        assertEquals(amber to "Out of usage", BotPresence("offline", "usage_limit", "2026-11-18T18:00:00.000Z").tag)
        for (reason in listOf("runtime_deleted", "runtime_disabled", "owner_removed", "a_reason_this_build_does_not_know")) {
            assertEquals(reason, red to "Unavailable", BotPresence("offline", reason).tag)
        }
    }

    @Test fun onlyAnOfflineComputerShowsTheStrip() {
        for (presence in listOf(online, """{"state":"busy"}""", """{"state":"offline","reason":"sign_in_required"}""",
            """{"state":"offline","reason":"usage_limit"}""", """{"state":"offline","reason":"runtime_deleted"}""", null)) {
            assertNull(presence, ChannelAgent.offlineStrip(listOf(agent("b", "Scribe", presence)), botId = null))
        }
    }
}
