package ai.nuphos.android

import ai.nuphos.android.data.AgentChatApi
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.AgentConversationsPage
import ai.nuphos.android.model.ChatFace
import ai.nuphos.android.session.BotArchive
import ai.nuphos.android.session.BotArchive.Result
import ai.nuphos.android.session.BotArchive.State
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.time.Instant

/** Archive Bot: every page searched first, then one write at a time, undone or reported when one fails. */
class BotArchiveTest {
    private val bot = "bot"
    private fun chat(id: String, with: String = bot, archived: Boolean = false) = AgentConversation(sessionId = id, kind = "channel",
        faces = listOf(ChatFace(with, "Grace", agent = ChatFace.Agent("05-rembrandt"))), archivedAt = if (archived) Instant.EPOCH else null)
    private fun group(id: String) = AgentConversation(sessionId = id, kind = "channel",
        faces = listOf(ChatFace("p1", "Diana"), ChatFace(bot, "Grace", agent = ChatFace.Agent("05-rembrandt"))))

    /** The server: pages of chats, and what each write answers. Records every request in order. */
    private inner class Server(vararg pages: AgentConversationsPage) {
        val pages = pages.toList()
        val requests = mutableListOf<String>()
        var listFails: Int? = null
        val answers = mutableMapOf<Pair<String, Boolean>, () -> Unit>()
        var allowedUntil = Int.MAX_VALUE
        var checks = 0
        fun archive() = BotArchive(
            listChats = { cursor ->
                val index = cursor?.removePrefix("c")?.toInt() ?: 0
                requests += "GET $index"
                if (listFails == index) throw IOException("synthetic")
                this.pages[index]
            },
            setArchived = { id, archived ->
                requests += "PATCH $id $archived"
                answers[id to archived]?.invoke()
            },
            allowed = { checks++ < allowedUntil },
        )
        val writes get() = requests.filter { it.startsWith("PATCH") }
    }
    private fun page(vararg rows: AgentConversation, next: String? = null, more: Boolean = next != null) =
        AgentConversationsPage(rows.toList(), next, more)
    private fun refused(status: Int): () -> Unit = { throw AgentChatApi.Conflict.Other("fixture", "Synthetic refusal", status) }
    private val lost: () -> Unit = { throw IOException("synthetic lost answer") }

    @Test fun archivesEachChatThenTheBot() = runBlocking {
        val server = Server(page(chat("one"), group("group"), chat("other", with = "someone-else")))
        assertEquals(Result.Archived, server.archive().run(bot))
        assertEquals("Only its 1:1 chat, then the Bot", listOf("PATCH one true", "PATCH bot true"), server.writes)
    }

    @Test fun aChatPastTheFirstHundredIsFoundOnTheNextPage() = runBlocking {
        val first = (1..100).map { chat("c-$it", with = "someone-else") }.toTypedArray()
        val server = Server(page(*first, next = "c1"), page(chat("far")))
        assertEquals(Result.Archived, server.archive().run(bot))
        assertEquals(listOf("GET 0", "GET 1", "PATCH far true", "PATCH bot true"), server.requests)
    }

    @Test fun aPageThatFailsArchivesNothing() = runBlocking {
        val server = Server(page(chat("one"), next = "c1"), page(chat("two")))
        server.listFails = 1
        assertEquals(Result.NotChanged(BotArchive.SEARCH_FAILED), server.archive().run(bot))
        assertTrue(server.writes.isEmpty())
    }

    @Test fun moreWithNoNextPageOrTheSamePageAgainIsNotTheEnd() = runBlocking {
        val missing = Server(page(chat("one"), more = true))
        assertEquals(Result.NotChanged(BotArchive.SEARCH_INCOMPLETE), missing.archive().run(bot))
        val repeated = Server(page(chat("one"), next = "c1"), page(chat("two"), next = "c1"))
        assertEquals(Result.NotChanged(BotArchive.SEARCH_INCOMPLETE), repeated.archive().run(bot))
        assertTrue(missing.writes.isEmpty() && repeated.writes.isEmpty())
    }

    @Test fun pastTheLastPageItReadsSaysIncompleteNotNone() = runBlocking {
        val pages = (0 until BotArchive.MAX_PAGES).map { page(chat("c$it", with = "someone-else"), next = "c${it + 1}") }
        val server = Server(*pages.toTypedArray())
        assertEquals(Result.NotChanged(BotArchive.SEARCH_INCOMPLETE), server.archive().run(bot))
        assertEquals(BotArchive.MAX_PAGES, server.requests.size)
        assertTrue(server.writes.isEmpty())
    }

    @Test fun noChatAfterReadingEverythingArchivesTheBotAlone() = runBlocking {
        val server = Server(page(chat("x", with = "someone-else"), next = "c1"), page())
        assertEquals(Result.Archived, server.archive().run(bot))
        assertEquals(listOf("PATCH bot true"), server.writes)
    }

    @Test fun aChatArchivedBeforeIsLeftAloneEvenWhenUndoing() = runBlocking {
        val server = Server(page(chat("before", archived = true), chat("now")))
        server.answers["bot" to true] = refused(500)
        assertEquals(Result.NotChanged(BotArchive.FAILED), server.archive().run(bot))
        assertEquals(listOf("PATCH now true", "PATCH bot true", "PATCH now false"), server.writes)
    }

    @Test fun theSecondChatFailingRestoresTheFirstAndLeavesTheBot() = runBlocking {
        val server = Server(page(chat("one"), chat("two")))
        server.answers["two" to true] = refused(500)
        assertEquals(Result.NotChanged(BotArchive.FAILED), server.archive().run(bot))
        assertEquals(listOf("PATCH one true", "PATCH two true", "PATCH one false"), server.writes)
    }

    @Test fun theBotFailingRestoresTheChatsNewestFirst() = runBlocking {
        val server = Server(page(chat("one"), chat("two")))
        server.answers["bot" to true] = refused(500)
        assertEquals(Result.NotChanged(BotArchive.FAILED), server.archive().run(bot))
        assertEquals(listOf("PATCH one true", "PATCH two true", "PATCH bot true", "PATCH two false", "PATCH one false"), server.writes)
    }

    @Test fun aRestoreThatFailsIsReportedAsStillArchivedNeverDone() = runBlocking {
        val server = Server(page(chat("one")))
        server.answers["bot" to true] = refused(500)
        server.answers["one" to false] = refused(500)
        val result = server.archive().run(bot)
        assertEquals(Result.Partial(mapOf("one" to State.Archived), State.NotArchived, BotArchive.NOT_RESTORED), result)
    }

    @Test fun anAnswerThatNeverCameIsUnknownAndUndoneAnyway() = runBlocking {
        // Archiving is a value, not a toggle, so restoring a write that may not have happened is safe.
        val server = Server(page(chat("one")))
        server.answers["one" to true] = lost
        assertEquals(Result.NotChanged(BotArchive.FAILED), server.archive().run(bot))
        assertEquals(listOf("PATCH one true", "PATCH one false"), server.writes)
        val botLost = Server(page(chat("one")))
        botLost.answers["bot" to true] = lost
        assertEquals(Result.NotChanged(BotArchive.FAILED), botLost.archive().run(bot))
        assertEquals(listOf("PATCH one true", "PATCH bot true", "PATCH bot false", "PATCH one false"), botLost.writes)
        val restoreLost = Server(page(chat("one")))
        restoreLost.answers["one" to true] = lost
        restoreLost.answers["one" to false] = lost
        assertEquals(Result.Partial(mapOf("one" to State.Unknown), State.NotArchived, BotArchive.NOT_RESTORED), restoreLost.archive().run(bot))
    }

    @Test fun aRestoreWhoseAnswerIsLostMakesThatChatUnknown() = runBlocking {
        // Archived for sure, then the restore may have happened: it can no longer be reported as archived.
        val server = Server(page(chat("one"), chat("two")))
        server.answers["bot" to true] = refused(500)
        server.answers["two" to false] = lost
        val result = server.archive().run(bot)
        assertEquals(listOf("PATCH one true", "PATCH two true", "PATCH bot true", "PATCH two false"), server.writes)
        assertEquals(Result.Partial(mapOf("one" to State.Archived, "two" to State.Unknown), State.NotArchived, BotArchive.NOT_RESTORED), result)
    }

    @Test fun aBotRestoreWhoseAnswerIsLostLeavesTheBotUnknownAndTheChatsAsTheyAre() = runBlocking {
        val server = Server(page(chat("one")))
        server.answers["bot" to true] = lost
        server.answers["bot" to false] = lost
        val result = server.archive().run(bot)
        assertEquals(listOf("PATCH one true", "PATCH bot true", "PATCH bot false"), server.writes)
        assertEquals(Result.Partial(mapOf("one" to State.Archived), State.Unknown, BotArchive.NOT_RESTORED), result)
    }

    @Test fun aReportFromBeforeASignOutIsNotKept() {
        ai.nuphos.android.session.BotArchiveIssues.clearAll()
        val issue = ai.nuphos.android.session.BotArchiveIssues.Issue("team", bot, "Grace", Result.NotChanged(BotArchive.FAILED))
        val started = ai.nuphos.android.session.BotArchiveIssues.epoch
        ai.nuphos.android.session.BotArchiveIssues.put("token", issue, started)
        assertEquals("Same sign-in: kept", issue, ai.nuphos.android.session.BotArchiveIssues.of("token"))
        ai.nuphos.android.session.BotArchiveIssues.clearAll()
        ai.nuphos.android.session.BotArchiveIssues.put("token", issue, started)
        assertNull("Finished after a sign-out: dropped", ai.nuphos.android.session.BotArchiveIssues.of("token"))
        ai.nuphos.android.session.BotArchiveIssues.clearAll()
    }

    @Test fun refusedForAccessSendsNothingMoreNotEvenARestore() = runBlocking {
        for (status in listOf(401, 403)) {
            val server = Server(page(chat("one"), chat("two")))
            server.answers["two" to true] = if (status == 401) ({ throw NuphosApi.Failure.Unauthorized }) else refused(403)
            val result = server.archive().run(bot)
            assertEquals("$status", listOf("PATCH one true", "PATCH two true"), server.writes)
            assertEquals(Result.Partial(mapOf("one" to State.Archived), State.NotArchived, BotArchive.NO_ACCESS), result)
        }
        val bot403 = Server(page())
        bot403.answers["bot" to true] = refused(403)
        assertEquals(Result.NotChanged(BotArchive.NO_ACCESS), bot403.archive().run(bot))
    }

    @Test fun accessEndingBeforeAnyWriteDropsItQuietly() = runBlocking {
        val server = Server(page(chat("one")))
        server.allowedUntil = 2 // Before and after reading the page.
        assertEquals(Result.NotChanged(null), server.archive().run(bot))
        assertTrue(server.writes.isEmpty())
    }

    @Test fun accessEndingAfterAWriteStopsAndReportsWithoutRestoring() = runBlocking {
        val server = Server(page(chat("one"), chat("two")))
        server.allowedUntil = 3 // The page, then the first chat.
        val result = server.archive().run(bot)
        assertEquals(listOf("PATCH one true"), server.writes)
        assertEquals(Result.Partial(mapOf("one" to State.Archived), State.NotArchived, BotArchive.STOPPED), result)
    }

    @Test fun accessEndingDuringARestoreStopsTheRestore() = runBlocking {
        val server = Server(page(chat("one"), chat("two")))
        server.answers["bot" to true] = refused(500)
        server.allowedUntil = 6 // Page, two chats, the Bot, one restore.
        val result = server.archive().run(bot)
        assertEquals(listOf("PATCH one true", "PATCH two true", "PATCH bot true", "PATCH two false"), server.writes)
        assertEquals(Result.Partial(mapOf("one" to State.Archived, "two" to State.NotArchived), State.NotArchived, BotArchive.STOPPED), result)
    }

    @Test fun tryingAgainFromAPartialStateFinishesWithoutTouchingWhatsDone() = runBlocking {
        // "one" was archived by the attempt that stopped; reading again shows it so.
        val server = Server(page(chat("one", archived = true), chat("two")))
        assertEquals(Result.Archived, server.archive().run(bot))
        assertEquals(listOf("PATCH two true", "PATCH bot true"), server.writes)
    }

    @Test fun restoreChatsReadsFirstAndOnlyUnarchivesWhatsStillArchived() = runBlocking {
        val server = Server(page(chat("one", archived = true), chat("two"), chat("before", archived = true)))
        assertEquals(Result.NotChanged(BotArchive.RESTORED), server.archive().restoreChats(bot, setOf("one", "two")))
        assertEquals(listOf("GET 0", "PATCH one false"), server.requests)
        val failing = Server(page(chat("one", archived = true)))
        failing.listFails = 0
        assertEquals(Result.NotChanged(BotArchive.SEARCH_FAILED), failing.archive().restoreChats(bot, setOf("one")))
        assertTrue(failing.writes.isEmpty())
    }
}
