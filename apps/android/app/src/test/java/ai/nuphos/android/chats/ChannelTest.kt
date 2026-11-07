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
import ai.nuphos.android.model.ComposerAttachment
import ai.nuphos.android.model.ComposerSubmission
import ai.nuphos.android.model.ConversationScope
import ai.nuphos.android.model.HomePage
import ai.nuphos.android.session.ChannelSession
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class ChannelTest {
    private fun message(json: String): ChatMessage = Http.json.decodeFromString(json)
    private val person = """{"id":"m1","role":"user","metadata":{"version":1,"sender":{"type":"user","id":"diana","displayName":"Diana Prince"},"sentAt":"2026-11-03T09:20:00.000Z"},"parts":[{"type":"text","text":"Morning!"}]}"""
    private val agent = """{"id":"m2","role":"user","metadata":{"version":1,"sender":{"type":"agent","id":"agent-ops","displayName":"Release ops"},"sentAt":"2026-11-03T09:23:00.000Z","sourceSessionId":"agent-ops"},"parts":[{"type":"text","text":"Screenshots:"},{"type":"transfer-download","groupId":"g1"},{"type":"transfer-download","groupId":"g2"}]}"""
    private val upload = """{"id":"m3","role":"user","metadata":{"version":1,"sender":{"type":"user","id":"diana","displayName":"Diana Prince"},"sentAt":"2026-11-03T09:40:00.000Z"},"parts":[{"type":"text","text":"Crash"},{"type":"transfer-upload","groupId":"64b5f1c2e4b0a1d2c3e4f5a7","status":"ready","files":[{"fileName":"crash.png","status":"ready"}]}]}"""

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
        assertEquals(listOf("time.m1", "post.m1", "post.m2", items[3].key, "time.m3", "post.m3", "post.local", "typing"), items.map { it.key })
        assertTrue(items[3] is ChannelItem.Paused)
        assertEquals("The first post is timed", a.sentAt, (items[0] as ChannelItem.Time).at)
        assertTrue((items[1] as ChannelItem.Post).first); assertTrue((items[2] as ChannelItem.Post).first)
        assertTrue("A post after a pause starts a run", (items[5] as ChannelItem.Post).first)
        assertFalse("Same sender continues the run", (items[6] as ChannelItem.Post).first)
        assertEquals(listOf("m1"), ChannelPost.stillSending(listOf(b), listOf(a, b)).map { it.id })
    }

    @Test fun aPauseOfMoreThanFifteenMinutesShowsATimeAndStartsANewRun() {
        val a = ChannelPost.from(message(person))!!
        fun at(id: String, time: String) = a.copy(id = id, sentAt = Instant.parse(time))
        val posts = listOf(a, at("m2", "2026-11-03T09:35:00Z"), at("m3", "2026-11-03T09:50:01Z"), at("m4", "2026-11-03T12:40:00Z"),
            at("m5", "2026-11-03T12:41:00Z"), at("local", "2026-11-03T20:00:00Z").copy(sending = true))
        val items = ChannelPost.items(posts, emptyList(), emptyList())
        assertEquals(listOf("time.m1", "post.m1", "post.m2", "time.m3", "post.m3", "time.m4", "post.m4", "post.m5", "time.local", "post.local"),
            items.map { it.key })
        val runs = items.filterIsInstance<ChannelItem.Post>().associate { it.post.id to it.first }
        assertEquals(mapOf("m1" to true, "m2" to false, "m3" to true, "m4" to true, "m5" to false, "local" to true), runs)
        assertTrue("Exactly 15 minutes is no pause", items.none { it.key == "time.m2" })
        assertEquals("A post on its way shows its time at once", Instant.parse("2026-11-03T20:00:00Z"),
            (items.first { it.key == "time.local" } as ChannelItem.Time).at)
        assertEquals("The chat returning it adds no row", items.map { it.key },
            ChannelPost.items(posts.map { it.copy(sending = false) }, emptyList(), emptyList()).map { it.key })
    }

    private class FakeTransport : ChannelSession.Transport {
        companion object {
            const val POST = """{"id":"m1","role":"user","metadata":{"version":1,"sender":{"type":"user","id":"d","displayName":"D"},"sentAt":"2026-11-03T09:20:00Z"},"parts":[{"type":"text","text":"hi"}]}"""
        }
        var details = mutableListOf<Int>()
        var stamp = "t1"; var count = 1
        var title = "release-planning"; var avatar = "05"
        var activity: Int? = null
        var failDetail = false
        var agentsCalls = 0
        val attachments = mutableListOf<String>()
        var failAttachment = true
        override suspend fun detail(tail: Int): AgentConversationDetail {
            details += tail
            if (failDetail) error("offline")
            val mine = landed?.let { ",{\"id\":\"$it\",\"role\":\"user\",\"metadata\":{\"version\":1,\"sender\":{\"type\":\"user\",\"id\":\"me\",\"displayName\":\"Me\"},\"sentAt\":\"2026-11-03T09:40:00Z\"},\"parts\":[{\"type\":\"text\",\"text\":\"Posted\"}]}" }.orEmpty()
            val post = if (tail == 1) "" else POST + mine
            return Http.json.decodeFromString(
                "{\"kind\":\"channel\",\"title\":\"" + title + "\",\"faces\":[{\"id\":\"bot-1\",\"name\":\"" + title +
                    "\",\"agent\":{\"avatar\":\"" + avatar + "\"}}],\"transcriptUpdatedAt\":\"" + stamp +
                    "\",\"messageCount\":" + count + ",\"activitySeq\":" + (activity ?: count) + ",\"messages\":[" + post + "]}")
        }
        override suspend fun agents(): List<ChannelAgent> { agentsCalls++; return listOf(ChannelAgent("agent-ops", "Release ops")) }
        override suspend fun attachment(groupId: String): TransferDownloadGroup {
            attachments += groupId
            if (failAttachment) error("offline")
            return TransferDownloadGroup(groupId, "2099-01-01T00:00:00Z", emptyList())
        }
        val uploads = mutableListOf<List<String>>()
        val posts = mutableListOf<Triple<String, String, String?>>()
        var failPost = false
        var landed: String? = null
        var heldUpload: kotlinx.coroutines.CompletableDeferred<Unit>? = null
        override suspend fun upload(attachments: List<ComposerAttachment>): String {
            uploads += attachments.map { it.name }; heldUpload?.await(); return "64b5f1c2e4b0a1d2c3e4f5a9"
        }
        override suspend fun post(text: String, id: String, upload: String?) {
            posts += Triple(text, id, upload)
            if (failPost) throw NuphosApi.Failure.Http(500, "Synthetic post failure")
            landed = id
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

    @Test fun renamingTheBotReadsTheChatAgainWithoutAPost() = runTest {
        val transport = FakeTransport()
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        session.refresh(force = true)
        transport.title = "Scout"
        session.refresh()
        assertEquals(listOf(ChannelSession.TAIL, 1, ChannelSession.TAIL), transport.details)
        assertEquals("Scout", session.title); assertEquals("Scout", session.faces.single().name)
        transport.avatar = "07"
        session.refresh()
        assertEquals("A new face reads it again too", listOf(ChannelSession.TAIL, 1, ChannelSession.TAIL, 1, ChannelSession.TAIL), transport.details)
        session.refresh()
        assertEquals("Then it is unchanged", 6, transport.details.size)
    }

    @Test fun returningEndsOnlyWithThePollsOwnGoodRead() = runTest {
        val transport = FakeTransport()
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        assertFalse("A first open isn't a return", session.returning)
        val first = launch { session.poll() }
        testScheduler.runCurrent()
        assertFalse(session.returning)
        first.cancel(); first.join()
        assertTrue("Leaving starts it", session.returning)
        // Another caller's read doesn't end it: it may predate what arrived.
        session.refresh(force = true)
        assertTrue(session.returning)
        // A failed read brought nothing, so it holds through the retry.
        transport.failDetail = true
        val second = launch { session.poll() }
        testScheduler.runCurrent()
        assertTrue("The read failed", session.returning)
        transport.failDetail = false
        testScheduler.advanceTimeBy(ChannelSession.POLL_MS + 1)
        testScheduler.runCurrent()
        assertFalse("The next good read ends it", session.returning)
        second.cancel(); second.join()
    }

    @Test fun aRefreshSaysWhetherItCouldRead() = runTest {
        val transport = FakeTransport()
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        assertTrue(session.refresh(force = true))
        assertTrue("An unchanged probe read the chat", session.refresh())
        transport.failDetail = true
        assertFalse(session.refresh(force = true))
        assertFalse(session.refresh())
        transport.failDetail = false
        assertTrue(session.refresh(force = true))
    }

    @Test fun theProbeSeesActivityThatLandsAfterThePost() = runTest {
        val transport = FakeTransport()
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        session.refresh(force = true)
        // Read between the server's two writes: the post is there, its activity not yet.
        transport.stamp = "t2"; transport.count = 2; transport.activity = 1
        session.refresh()
        assertEquals(1L, session.activitySeq)
        val reads = transport.details.size
        transport.activity = 2
        session.refresh()
        assertEquals("The stamp did not change, the activity did", 2L, session.activitySeq)
        assertEquals("Only the probe ran", reads + 1, transport.details.size)
        transport.activity = 1
        session.refresh()
        assertEquals("Activity never goes back", 2L, session.activitySeq)
    }

    @Test fun aReadMarkerRetriesUntilItLandsAndIsNotRepeated() = runTest {
        val transport = FakeTransport()
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        val marks = mutableListOf<Long>()
        var fail = true
        val mark: suspend (Long) -> Unit = { marks += it; if (fail) error("offline") }
        session.readUpToNewest(mark)
        assertTrue("Nothing to mark before the first read", marks.isEmpty())
        val before = session.reads
        session.refresh(force = true)
        assertTrue("Every read gives a failed marker its retry", session.reads > before)
        session.readUpToNewest(mark); session.readUpToNewest(mark)
        assertEquals(listOf(1L, 1L), marks)
        fail = false
        session.readUpToNewest(mark); session.readUpToNewest(mark)
        assertEquals("It landed once, and is not sent again", listOf(1L, 1L, 1L), marks)
        transport.stamp = "t2"; transport.count = 2
        session.refresh()
        session.readUpToNewest(mark)
        assertEquals(listOf(1L, 1L, 1L, 2L), marks)
    }

    @Test fun leavingDuringAReadMarkerCancelsIt() = runTest {
        val session = ChannelSession("team", "chat-release", "Chat", FakeTransport())
        session.refresh(force = true)
        var calls = 0
        val cancelled = runCatching { session.readUpToNewest { calls++; throw kotlinx.coroutines.CancellationException("left") } }
        assertTrue(cancelled.exceptionOrNull() is kotlinx.coroutines.CancellationException)
        session.readUpToNewest { calls++ }
        assertEquals("A cancelled marker is still owed", 2, calls)
    }

    @Test fun aFailedFileReadIsRetriedNotCached() = runTest {
        val transport = FakeTransport()
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        try { session.transferGroup("g1"); fail() } catch (_: IllegalStateException) { }
        transport.failAttachment = false
        assertEquals("g1", session.transferGroup("g1").groupId)
        assertEquals(listOf("g1", "g1"), transport.attachments)
    }

    @Test fun aPostShowsAtOnceUploadsFirstAndIsNotShownTwice() = runTest {
        val transport = FakeTransport()
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        session.refresh(force = true)
        val file = ComposerAttachment(name = "crash.png", kind = ComposerAttachment.Kind.Image(byteArrayOf(1)))
        assertTrue(session.send(ComposerSubmission("  Ship it  ", listOf(file)), "me", "Me", null, this) { "client-1" })
        assertEquals(listOf("client-1"), session.sending.map { it.id })
        assertTrue("Shown at once, before the chat returns it", session.posts.last().sending)
        assertEquals(listOf("crash.png"), session.sendingAttachments["client-1"]?.map { it.name })
        assertEquals("post.client-1", session.lastSubmittedKey)
        testScheduler.advanceUntilIdle()
        assertEquals(listOf(listOf("crash.png")), transport.uploads)
        assertEquals(Triple("Ship it", "client-1", "64b5f1c2e4b0a1d2c3e4f5a9"), transport.posts.single())
        // The chat returned the post under the same id: it shows once, as stored.
        assertTrue(session.sending.isEmpty()); assertTrue(session.sendingAttachments.isEmpty())
        assertEquals(1, session.posts.count { it.id == "client-1" }); assertFalse(session.posts.last().sending)
    }

    @Test fun aFailedPostIsRemovedRestoredAndRetriedUnderTheSameId() = runTest {
        val transport = FakeTransport().apply { failPost = true }
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        session.refresh(force = true)
        var ids = 0
        val submission = ComposerSubmission("Hello")
        assertTrue(session.send(submission, "me", "Me", null, this) { "client-${++ids}" })
        testScheduler.advanceUntilIdle()
        assertTrue(session.sending.isEmpty())
        assertEquals(submission, session.unsent)
        assertEquals("Synthetic post failure", session.sendError)
        // A retry of the same content reuses the id, so a post that did land is not doubled.
        transport.failPost = false
        assertTrue(session.send(submission, "me", "Me", null, this) { "client-${++ids}" })
        testScheduler.advanceUntilIdle()
        assertEquals(listOf("client-1", "client-1"), transport.posts.map { it.second })
        // New content gets a new id.
        assertTrue(session.send(ComposerSubmission("Something else"), "me", "Me", null, this) { "client-${++ids}" })
        testScheduler.advanceUntilIdle()
        assertEquals("client-2", transport.posts.last().second)
        assertFalse(session.send(ComposerSubmission("   "), "me", "Me", null, this))
    }

    @Test fun aScopeChangeDuringUploadNeverPostsOrRestores() = runTest {
        val transport = FakeTransport().apply { heldUpload = kotlinx.coroutines.CompletableDeferred() }
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        session.refresh(force = true)
        var current = true
        val file = ComposerAttachment(name = "crash.png", kind = ComposerAttachment.Kind.Image(byteArrayOf(1)))
        assertTrue(session.send(ComposerSubmission("Ship it", listOf(file)), "me", "Me", null, this, { current }) { "client-1" })
        testScheduler.advanceUntilIdle()
        assertEquals(1, transport.uploads.size)
        // The account, workspace or consent changes while the files upload.
        current = false
        transport.heldUpload!!.complete(Unit)
        testScheduler.advanceUntilIdle()
        assertTrue("No late post", transport.posts.isEmpty())
        assertTrue(session.sending.isEmpty()); assertNull(session.unsent); assertNull(session.sendError)
        assertFalse("A stale composer cannot start another post", session.send(ComposerSubmission("Again"), "me", "Me", null, this, { current }))
    }

    @Test fun leavingDuringUploadCancelsWithoutPostingOrRestoring() = runTest {
        val transport = FakeTransport().apply { heldUpload = kotlinx.coroutines.CompletableDeferred() }
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        session.refresh(force = true)
        val composer = kotlinx.coroutines.CoroutineScope(coroutineContext + kotlinx.coroutines.Job())
        val file = ComposerAttachment(name = "crash.png", kind = ComposerAttachment.Kind.Image(byteArrayOf(1)))
        assertTrue(session.send(ComposerSubmission("Ship it", listOf(file)), "me", "Me", null, composer) { "client-1" })
        testScheduler.advanceUntilIdle()
        composer.coroutineContext[kotlinx.coroutines.Job]!!.cancel()
        transport.heldUpload!!.complete(Unit)
        testScheduler.advanceUntilIdle()
        assertTrue(transport.posts.isEmpty())
        assertTrue(session.sending.isEmpty()); assertNull(session.unsent); assertNull(session.sendError)
    }

    @Test fun aRetryMatchesTheSameFilesNotTheSameNames() = runTest {
        val transport = FakeTransport().apply { failPost = true }
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        session.refresh(force = true)
        var ids = 0
        val first = ComposerAttachment(name = "photo.png", kind = ComposerAttachment.Kind.Image(byteArrayOf(1)))
        val submission = ComposerSubmission("Look", listOf(first))
        session.send(submission, "me", "Me", null, this) { "client-${++ids}" }
        testScheduler.advanceUntilIdle()
        // The post put back after a failure keeps its id.
        session.send(session.unsent!!, "me", "Me", null, this) { "client-${++ids}" }
        testScheduler.advanceUntilIdle()
        assertEquals(listOf("client-1", "client-1"), transport.posts.map { it.second })
        // Same caption, a newly picked file with the same name: a new post, never the old id.
        val other = ComposerAttachment(name = "photo.png", kind = ComposerAttachment.Kind.Image(byteArrayOf(2)))
        session.send(ComposerSubmission("Look", listOf(other)), "me", "Me", null, this) { "client-${++ids}" }
        testScheduler.advanceUntilIdle()
        assertEquals("client-2", transport.posts.last().second)
    }

    @Test fun aFailedPostShowsTheServerReasonButNeverARawPayload() {
        val reason = ai.nuphos.android.data.AgentChatApi.conflict(500, """{"error":{"message":"Synthetic post failure"}}""")
        assertEquals("Synthetic post failure", ChannelSession.postFailureMessage(reason))
        assertEquals("Check your connection and try again.", ChannelSession.postFailureMessage(ai.nuphos.android.data.AgentChatApi.conflict(502, "<html>bad gateway</html>")))
        assertEquals("Check your connection and try again.", ChannelSession.postFailureMessage(java.io.IOException("socket")))
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
