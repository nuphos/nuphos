package ai.nuphos.android.chats

import ai.nuphos.android.data.Http
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.data.TransferDownloadGroup
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.AgentConversationsPage
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.model.ComposerAttachment
import ai.nuphos.android.model.InputRequest
import ai.nuphos.android.session.BotQuestions
import ai.nuphos.android.session.ChannelSession
import ai.nuphos.android.session.OpenQuestions
import ai.nuphos.android.ui.chats.isLongBody
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class BotQuestionsTest {
    private fun row(id: String, parent: String? = null, owner: Boolean = true, vararg asks: Pair<String, String>) =
        AgentConversation(sessionId = id, title = id, isOwner = owner, parentSessionId = parent,
            inputRequests = asks.map { (requestId, at) -> InputRequest(requestId, "approval", "Ship?", listOf("Yes", "No"), at) }
                .ifEmpty { null })

    // The pending listing: rows that ask, then every parent above them, which ask nothing.
    private val listing = listOf(
        row("canary", "rollout", true, "q-canary" to "2026-11-09T03:03:00Z"),
        row("docs", "bot-1", true, "q-docs" to "2026-11-09T03:01:00Z"),
        row("bot-1", null, true, "q-bot" to "2026-11-09T03:02:00Z"),
        row("rollout", "bot-1"),
    )

    @Test fun listsTheBotsQuestionsAtAnyDepthOldestFirst() {
        val questions = BotQuestions.under("bot-1", listing)
        assertEquals(listOf("q-docs", "q-bot", "q-canary"), questions.map { it.request.id })
        assertEquals(listOf("docs", "bot-1", "canary"), questions.map { it.sessionId })
        assertEquals("https://nuphos.ai/teams/t1/agent/canary", questions.last().link("t1"))
    }

    @Test fun leavesOutOtherBotsTeammatesAndLoops() {
        val rows = listOf(
            row("elsewhere", "other-bot", true, "q-1" to "a"),
            row("theirs", "bot-1", false, "q-2" to "b"),
            row("orphan", "unlisted", true, "q-3" to "c"),
            row("loop-a", "loop-b", true, "q-4" to "d"), row("loop-b", "loop-a"),
        )
        assertTrue(BotQuestions.under("bot-1", rows).isEmpty())
    }

    @Test fun keepsTheBodyTheAgentWroteToDecideFrom() {
        val request = Http.json.decodeFromString(InputRequest.serializer(),
            """{"id":"q","question":"Direction OK?","body":"**Why:** see [#412](https://example.com/412)","status":"open"}""")
        assertEquals("**Why:** see [#412](https://example.com/412)", request.body)
        assertNull(Http.json.decodeFromString(InputRequest.serializer(), """{"id":"q","question":"Ship?"}""").body)
        // Up to three short lines show whole; more collapses behind "Show more".
        assertFalse(isLongBody("One finding.\nA second.\nA third."))
        assertTrue(isLongBody("1\n2\n3\n4"))
        assertTrue(isLongBody("x".repeat(241)))
    }

    @Test fun decodesTheOpenRequestsOfAListRowAndAsksForThem() {
        val page = Http.json.decodeFromString(AgentConversationsPage.serializer(), """
            {"conversations":[{"sessionId":"canary","parentSessionId":"rollout","isOwner":true,
              "inputRequests":[{"id":"q-canary","category":"approval","question":"Ship?","options":["Yes"],
              "askedAt":"2026-11-09T03:03:00Z","status":"open"}]}],
             "parents":[{"sessionId":"rollout","parentSessionId":"bot-1","isOwner":true}],"nextCursor":null,"hasMore":false}
        """)
        assertEquals(listOf("canary:q-canary"), BotQuestions.under("bot-1", page.rows).map { it.id })
        val query = NuphosApi.conversationQuery("team", pendingDecision = true).toMap()
        assertEquals("true", query["pendingDecision"])
        assertNull(NuphosApi.conversationQuery("team").toMap()["pendingDecision"])
    }

    private class FakeTransport : ChannelSession.Transport {
        var pending = listOf<AgentConversation>()
        val answers = mutableListOf<Triple<String, String, String>>()
        var failAnswer = false
        var faces = """[{"id":"bot-1","name":"Release Lead","agent":{"avatar":"05"}}]"""
        override suspend fun detail(tail: Int): AgentConversationDetail =
            Http.json.decodeFromString("""{"kind":"channel","title":"Release Lead","faces":$faces,"messages":[]}""")
        override suspend fun agents() = emptyList<ChannelAgent>()
        override suspend fun attachment(groupId: String) = TransferDownloadGroup(groupId, "2099-01-01T00:00:00Z", emptyList())
        override suspend fun upload(attachments: List<ComposerAttachment>) = "group"
        override suspend fun post(text: String, id: String, upload: String?, replyTo: String?) {}
        override suspend fun pending() = pending
        override suspend fun answer(sessionId: String, text: String, requestId: String) {
            answers += Triple(sessionId, text, requestId)
            if (failAnswer) throw NuphosApi.Failure.Http(500, "Synthetic answer failure")
        }
    }

    @Test fun anAnswerGoesToTheAskingConversationAndHidesTheCard() = runTest {
        val transport = FakeTransport().apply { pending = listing }
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        session.refresh(force = true)
        session.refreshQuestions()
        val canary = session.questions.single { it.sessionId == "canary" }
        session.answer(canary, "Yes", this)
        assertFalse(session.questions.any { it.id == canary.id })
        testScheduler.advanceUntilIdle()
        assertEquals(listOf(Triple("canary", "Yes", "q-canary")), transport.answers)
        // Until the listing drops it, an answered question stays hidden.
        session.refreshQuestions()
        assertFalse(session.questions.any { it.id == canary.id })
        transport.pending = listing.filter { it.sessionId != "canary" }
        session.refreshQuestions()
        assertEquals(listOf("q-docs", "q-bot"), session.questions.map { it.request.id })
    }

    @Test fun aFailedAnswerBringsTheCardBack() = runTest {
        val transport = FakeTransport().apply { pending = listing; failAnswer = true }
        val session = ChannelSession("team", "chat-release", "Chat", transport)
        session.refresh(force = true)
        session.refreshQuestions()
        val docs = session.questions.single { it.sessionId == "docs" }
        session.answer(docs, "No", this)
        testScheduler.advanceUntilIdle()
        assertTrue(session.questions.any { it.id == docs.id })
        assertNotNull(session.sendError)
    }

    @Test fun aChatThatIsNotABotsHasNoQuestions() = runTest {
        // A group chat: two people, no Bot.
        val transport = FakeTransport().apply {
            pending = listing
            faces = """[{"id":"u2","name":"Sam"},{"id":"u3","name":"Kim"}]"""
        }
        val session = ChannelSession("team", "chat-group", "Group", transport)
        session.refresh(force = true)
        session.refreshQuestions()
        assertTrue(session.questions.isEmpty())
    }

    @Test fun theInboxListsEveryOwnQuestionOnceAndAnswersIt() = runTest {
        val rows = listOf(
            row("deploy", "bot-1", true, "q-2" to "2026-11-09T03:02:00Z", "q-1" to "2026-11-09T03:01:00Z"),
            row("bot-1", null, true, "q-3" to "2026-11-09T03:03:00Z"),
            // Also listed as a parent: read once.
            row("deploy", "bot-1", true, "q-2" to "2026-11-09T03:02:00Z"),
            row("theirs", null, false, "q-4" to "2026-11-09T03:04:00Z"),
        )
        assertEquals(listOf("q-1", "q-2", "q-3"), BotQuestions.open(rows).map { it.request.id })

        val transport = FakeTransport().apply { pending = rows }
        val inbox = OpenQuestions(transport)
        inbox.refresh()
        assertTrue(inbox.loaded)
        val first = inbox.list.first()
        var error: Exception? = null
        inbox.answer(first, "Ship it", this) { error = it }
        assertFalse(inbox.list.any { it.id == first.id })
        testScheduler.advanceUntilIdle()
        assertEquals(listOf(Triple("deploy", "Ship it", "q-1")), transport.answers)
        assertNull(error)
    }
}
