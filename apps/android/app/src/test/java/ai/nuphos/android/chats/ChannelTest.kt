package ai.nuphos.android.chats

import ai.nuphos.android.data.Http
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.data.TransferDownloadGroup
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.model.ChannelItem
import ai.nuphos.android.model.ChannelPost
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.ConversationScope
import ai.nuphos.android.model.HomePage
import ai.nuphos.android.session.ChannelSession
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class ChannelTest {
    private fun message(json: String): ChatMessage = Http.json.decodeFromString(json)
    private val person = """{"id":"m1","role":"user","metadata":{"version":1,"sender":{"type":"user","id":"diana","displayName":"Diana Prince"},"sentAt":"2026-11-03T09:20:00.000Z"},"parts":[{"type":"text","text":"Morning!"}]}"""
    private val agent = """{"id":"m2","role":"user","metadata":{"version":1,"sender":{"type":"agent","id":"agent-ops","displayName":"Release ops"},"sentAt":"2026-11-03T09:23:00.000Z","sourceSessionId":"agent-ops"},"parts":[{"type":"text","text":"Screenshots:"},{"type":"transfer-download","groupId":"g1"},{"type":"transfer-download","groupId":"g2"}]}"""
    private val upload = """{"id":"m3","role":"user","metadata":{"version":1,"sender":{"type":"user","id":"diana","displayName":"Diana Prince"},"sentAt":"2026-11-03T09:30:00.000Z"},"parts":[{"type":"text","text":"Crash"},{"type":"transfer-upload","groupId":"64b5f1c2e4b0a1d2c3e4f5a7","status":"ready","files":[{"fileName":"crash.png","status":"ready"}]}]}"""

    @Test fun postsReadPeopleAgentsAndBothKindsOfFiles() {
        val a = ChannelPost.from(message(person))!!
        assertEquals("diana", a.senderId); assertFalse(a.isAgent); assertEquals("Morning!", a.text)
        assertTrue(a.isMine("diana")); assertFalse(a.isMine(null))
        val b = ChannelPost.from(message(agent))!!
        assertTrue(b.isAgent); assertEquals("agent-ops", b.senderId); assertEquals(listOf("g1", "g2"), b.downloads)
        assertFalse("An agent is never the viewer", b.isMine("agent-ops"))
        val c = ChannelPost.from(message(upload))!!
        assertEquals(listOf("64b5f1c2e4b0a1d2c3e4f5a7"), c.uploads.map { it.groupId }); assertEquals("Crash", c.text)
        assertEquals(listOf("64b5f1c2e4b0a1d2c3e4f5a7"), c.groups)
    }

    @Test fun messagesWithoutSenderOrContentAreDropped() {
        assertNull(ChannelPost.from(message("""{"id":"x","role":"user","parts":[{"type":"text","text":"no sender"}]}""")))
        assertNull(ChannelPost.from(message("""{"id":"x","role":"user","metadata":{"sender":{"type":"system","id":"s","displayName":"S"}},"parts":[{"type":"text","text":"x"}]}""")))
        assertNull(ChannelPost.from(message("""{"id":"x","role":"user","metadata":{"sender":{"type":"user","id":"d","displayName":"D"}},"parts":[{"type":"text","text":"  "}]}""")))
    }

    @Test fun runsPausedLineAndTypingAreOrdered() {
        val a = ChannelPost.from(message(person))!!
        val b = ChannelPost.from(message(agent))!!
        val c = ChannelPost.from(message(upload))!!
        val paused = AgentConversationDetail.TimelineEvent(Instant.parse("2026-11-03T09:25:00Z"), "Agents paused", "agents_paused")
        val other = AgentConversationDetail.TimelineEvent(Instant.parse("2026-11-03T09:26:00Z"), "Ignored", "other")
        val sending = c.copy(id = "local", sentAt = Instant.EPOCH, sending = true)
        val items = ChannelPost.items(listOf(a, b, c, sending), listOf(paused, other), listOf(ChannelAgent("agent-ops", "Release ops")))
        assertEquals(listOf("post.m1", "post.m2", items[2].key, "post.m3", "post.local", "typing"), items.map { it.key })
        assertTrue(items[2] is ChannelItem.Paused)
        assertTrue((items[0] as ChannelItem.Post).first); assertTrue((items[1] as ChannelItem.Post).first)
        assertTrue("A different sender starts a run", (items[3] as ChannelItem.Post).first)
        assertFalse("Same sender continues the run", (items[4] as ChannelItem.Post).first)
        assertEquals(listOf("m1"), ChannelPost.stillSending(listOf(b), listOf(a, b)).map { it.id })
    }

    private class FakeTransport : ChannelSession.Transport {
        companion object {
            const val POST = """{"id":"m1","role":"user","metadata":{"version":1,"sender":{"type":"user","id":"d","displayName":"D"},"sentAt":"2026-11-03T09:20:00Z"},"parts":[{"type":"text","text":"hi"}]}"""
        }
        var details = mutableListOf<Int>()
        var stamp = "t1"; var count = 1
        var agentsCalls = 0
        val attachments = mutableListOf<String>()
        var failAttachment = true
        override suspend fun detail(tail: Int): AgentConversationDetail {
            details += tail
            val post = if (tail == 1) "" else POST
            return Http.json.decodeFromString(
                "{\"kind\":\"channel\",\"title\":\"release-planning\",\"transcriptUpdatedAt\":\"" + stamp +
                    "\",\"messageCount\":" + count + ",\"activitySeq\":" + count + ",\"messages\":[" + post + "]}")
        }
        override suspend fun agents(): List<ChannelAgent> { agentsCalls++; return listOf(ChannelAgent("agent-ops", "Release ops")) }
        override suspend fun attachment(groupId: String): TransferDownloadGroup {
            attachments += groupId
            if (failAttachment) error("offline")
            return TransferDownloadGroup(groupId, "2099-01-01T00:00:00Z", emptyList())
        }
    }

    @Test fun probeSkipsTheFullReadUntilTheChatChanges() = runTest {
        val transport = FakeTransport()
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        session.refresh(force = true)
        assertEquals(listOf(ChannelSession.TAIL), transport.details)
        assertEquals("release-planning", session.title); assertEquals(1, session.posts.size); assertEquals(1L, session.activitySeq)
        session.refresh()
        assertEquals("An unchanged probe does not read again", listOf(ChannelSession.TAIL, 1), transport.details)
        assertEquals(1, transport.agentsCalls)
        transport.stamp = "t2"; transport.count = 2
        session.refresh()
        assertEquals(listOf(ChannelSession.TAIL, 1, 1, ChannelSession.TAIL), transport.details)
        assertEquals(2, transport.agentsCalls); assertEquals(2L, session.activitySeq)
    }

    @Test fun aFailedFileReadIsRetriedNotCached() = runTest {
        val transport = FakeTransport()
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        try { session.transferGroup("g1"); fail() } catch (_: IllegalStateException) { }
        transport.failAttachment = false
        assertEquals("g1", session.transferGroup("g1").groupId)
        assertEquals(listOf("g1", "g1"), transport.attachments)
    }

    @Test fun chatsAreTheirOwnListingAndLaunchFollowsTheLastAnswer() {
        val query = NuphosApi.conversationQuery("team", scope = ConversationScope.Shared, channels = true).toMap()
        assertEquals("channel", query["kind"]); assertEquals("shared", query["scope"]); assertEquals("activity", query["sort"])
        assertNull(NuphosApi.conversationQuery("team")["kind"])
        assertEquals(HomePage.Chats, HomePage.launch(true)); assertEquals(HomePage.Agent, HomePage.launch(false))
        assertEquals(HomePage.Chats, HomePage.entries.first())
    }

    @Test fun detailAndRowsDecodeKind() {
        val detail: AgentConversationDetail = Http.json.decodeFromString("""{"kind":"channel","messageCount":3,"timelineEvents":[{"kind":"agents_paused","at":"2026-11-03T09:33:00Z","text":"Paused"}]}""")
        assertTrue(detail.isChannel); assertEquals(3, detail.messageCount); assertEquals("agents_paused", detail.timelineEvents.single().kind)
        val row: ai.nuphos.android.model.AgentConversation = Http.json.decodeFromString("""{"sessionId":"c","kind":"channel"}""")
        assertTrue(row.isChannel)
        assertFalse(Http.json.decodeFromString<ai.nuphos.android.model.AgentConversation>("""{"sessionId":"a"}""").isChannel)
    }
}

private operator fun List<Pair<String, String>>.get(key: String) = toMap()[key]
