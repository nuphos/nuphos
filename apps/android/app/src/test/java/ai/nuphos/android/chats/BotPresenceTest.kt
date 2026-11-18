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

    @Test fun onlyAnOfflineComputerShowsTheStrip() {
        for (presence in listOf(online, """{"state":"busy"}""", """{"state":"offline","reason":"sign_in_required"}""",
            """{"state":"offline","reason":"usage_limit"}""", """{"state":"offline","reason":"runtime_deleted"}""", null)) {
            assertNull(presence, ChannelAgent.offlineStrip(listOf(agent("b", "Scribe", presence)), botId = null))
        }
    }
}
