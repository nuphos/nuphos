package ai.nuphos.android

import ai.nuphos.android.data.BotActions
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.BotAvatars
import ai.nuphos.android.model.BotFaces
import ai.nuphos.android.model.ChatFace
import ai.nuphos.android.model.botsList
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class BotsTest {
    private fun decode(json: String) = Http.json.decodeFromString<AgentConversation>(json)
    private fun agent(id: String, avatar: String? = "05-rembrandt") = ChatFace(id, id, agent = ChatFace.Agent(avatar))
    private fun channel(id: String, vararg faces: ChatFace, at: Long = 0) =
        AgentConversation(id, kind = "channel", faces = faces.toList(), lastActiveAt = Instant.ofEpochSecond(at))
    private fun session(id: String, avatar: String? = null, at: Long = 0, archivedAt: Instant? = null) =
        AgentConversation(id, avatar = avatar, lastActiveAt = Instant.ofEpochSecond(at), archivedAt = archivedAt)

    @Test fun anOlderServerWithoutTheNewFieldsStillDecodes() {
        val row = decode("""{"sessionId":"old","kind":"channel"}""")
        assertNull(row.avatar); assertNull(row.lastPost); assertNull(row.previewLine); assertNull(row.botId)
        assertFalse(row.isBot)
    }
    @Test fun aMalformedLastMessageOnlyLosesThePreview() {
        for (bad in listOf("3", "\"text\"", "[]", "{}", """{"text":3}""")) {
            val row = decode("""{"sessionId":"s","lastMessage":$bad}""")
            assertEquals("s", row.sessionId)
            assertNull(bad, row.previewLine)
        }
    }
    @Test fun anAgentWithAFaceIsABotButAChatWithOneIsNot() {
        assertTrue(session("s", avatar = "05-rembrandt").isBot)
        assertFalse(session("s").isBot)
        assertFalse(AgentConversation("c", kind = "channel", avatar = "05-rembrandt").isBot)
    }
    @Test fun onlyAChatWithOneAgentWithAFaceIsABots() {
        assertEquals("bot", channel("c", agent("bot")).botId)
        assertNull("Two members", channel("c", agent("bot"), agent("other")).botId)
        assertNull("A person", channel("c", ChatFace("p", "Person")).botId)
        assertNull("An agent without a face", channel("c", agent("task", avatar = null)).botId)
        assertNull("Not a chat", AgentConversation("s", faces = listOf(agent("bot"))).botId)
        assertNull("No members", channel("c").botId)
    }
    @Test fun aGroupsPreviewNamesWhoPostedAndABotsDoesNot() {
        val post = """{"text":"Hello","from":"Diana"}"""
        val group = decode("""{"sessionId":"g","kind":"channel","lastMessage":$post,"faces":[{"id":"a","name":"A"},{"id":"b","name":"B"}]}""")
        assertEquals("Diana: Hello", group.previewLine)
        val bot = decode("""{"sessionId":"b","kind":"channel","lastMessage":$post,"faces":[{"id":"x","name":"X","agent":{"avatar":"05-rembrandt"}}]}""")
        assertEquals("Hello", bot.previewLine)
        val mine = decode("""{"sessionId":"g","kind":"channel","lastMessage":{"text":"Mine"}}""")
        assertEquals("Mine", mine.previewLine)
    }
    @Test fun aPostWithOnlyFilesSaysAttachment() {
        val row = decode("""{"sessionId":"g","kind":"channel","lastMessage":{"text":"","from":"Diana"}}""")
        assertEquals("Diana: Attachment", row.previewLine)
    }
    @Test fun theListHasChatsAndBotsWithoutOneNewestFirst() {
        val list = botsList(
            listOf(channel("old-chat", at = 1), channel("bot-chat", agent("chatted"), at = 5)),
            listOf(session("chatted", "05-rembrandt", at = 9), session("waiting", "01-vermeer-girl", at = 3),
                session("task", at = 8), session("archived", "02-leonardo", at = 7, archivedAt = Instant.EPOCH)),
        )
        assertEquals(listOf("bot-chat", "waiting", "old-chat"), list.map { it.sessionId })
    }
    @Test fun creatingABotSendsItsNameFaceAndKnownRuntimeOnly() = runBlocking {
        var seen: JsonValue? = null
        val id = BotActions.create("synthetic", "team", "  Ada  ", "07-ada") { method, path, token, query, body ->
            assertEquals("POST", method); assertEquals("agent/bots", path); assertEquals("synthetic", token)
            assertEquals(listOf("teamId" to "team"), query)
            seen = body
            """{"sessionId":"new","title":"Ada","avatar":"07-ada"}"""
        }
        assertEquals("new", id)
        assertEquals(JsonValue.obj("title" to JsonValue.Str("Ada"), "avatar" to JsonValue.Str("07-ada")), seen)
        BotActions.create("synthetic", "team", "Ada", "07-ada", "r1", "codex", "Mine") { _, _, _, _, body ->
            seen = body; """{"sessionId":"new"}"""
        }
        assertEquals(JsonValue.Str("r1"), seen!!["runtimeId"])
        assertEquals(JsonValue.Str("codex"), seen!!["agentRuntime"])
        assertEquals(JsonValue.Str("Mine"), seen!!["runtimeLabel"])
    }
    @Test fun aBadNameNeverReachesTheServer() {
        for (name in listOf("", "   ", "x".repeat(121))) {
            assertThrows(IllegalArgumentException::class.java) {
                runBlocking { BotActions.create("synthetic", "team", name, "07-ada") { _, _, _, _, _ -> fail("Sent"); "" } }
            }
        }
    }
    @Test fun aResponseWithoutASessionIdIsAFailure() {
        assertThrows(NuphosApi.Failure.InvalidResponse::class.java) {
            runBlocking { BotActions.create("synthetic", "team", "Ada", "07-ada") { _, _, _, _, _ -> "{}" } }
        }
    }
    @Test fun aBotsChatIsMadeAndThenTheBotAddedToIt() = runBlocking {
        val calls = mutableListOf<Pair<String, JsonValue?>>()
        val chat = BotActions.createChannel("synthetic", "team") { method, path, _, query, body ->
            assertEquals("POST", method); assertEquals(listOf("teamId" to "team"), query)
            calls += path to body
            """{"sessionId":"chat /"}"""
        }
        BotActions.addBot("synthetic", "team", chat, "bot /") { method, path, _, query, body ->
            assertEquals("POST", method); assertEquals(listOf("teamId" to "team"), query)
            calls += path to body
            "{}"
        }
        assertEquals("chat /", chat)
        assertEquals(listOf("agent/channels", "agent/conversations/chat%20%2F/agents"), calls.map { it.first })
        assertEquals(JsonValue.obj(), calls[0].second)
        assertEquals(JsonValue.obj("sessionId" to JsonValue.Str("bot /")), calls[1].second)
    }
    @Test fun makingABotAndTurningItBackUseTheirRoutes() = runBlocking {
        BotActions.setBot("synthetic", "team", "s /", true) { method, path, _, query, body ->
            assertEquals("POST", method); assertEquals("agent/conversations/s%20%2F/bot", path)
            assertEquals(listOf("teamId" to "team"), query); assertEquals(JsonValue.obj(), body); "{}"
        }
        BotActions.setBot("synthetic", "team", "s /", false) { method, path, _, query, body ->
            assertEquals("PATCH", method); assertEquals("agent/conversations/s%20%2F/avatar", path)
            assertEquals(listOf("teamId" to "team"), query)
            assertEquals(JsonValue.obj("avatar" to JsonValue.Null), body); "{}"
        }
    }
    @Test fun facesAreLearnedFromListsAndForgottenWhenABotTurnsBack() {
        BotFaces.learn(listOf(session("bot", "05-rembrandt"), session("task"), channel("chat", agent("member", "07-ada"))))
        assertEquals("05-rembrandt", BotFaces.face("bot"))
        assertEquals("07-ada", BotFaces.face("member"))
        assertNull(BotFaces.face("task"))
        assertNull("A chat isn't a Bot", BotFaces.face("chat"))
        BotFaces.learn(listOf(session("bot")))
        assertNull(BotFaces.face("bot"))
        BotFaces.learn("member", null)
    }
    @Test fun aFaceThisBuildDoesNotShipIsNotNamed() {
        assertEquals("05-rembrandt.svg", BotAvatars.named("05-rembrandt"))
        assertNull(BotAvatars.named("99-unknown"))
    }
}
