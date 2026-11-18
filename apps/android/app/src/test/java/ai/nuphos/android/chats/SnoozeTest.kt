package ai.nuphos.android.chats

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.InputRequest
import ai.nuphos.android.session.OpenQuestions
import ai.nuphos.android.session.SnoozePreset
import ai.nuphos.android.session.snoozeTimes
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class SnoozeTest {
    private val zone = ZoneId.of("Asia/Taipei")
    private fun at(day: Int, hour: Int, minute: Int = 0) = ZonedDateTime.of(2026, 11, day, hour, minute, 0, 0, zone)
    private fun times(now: ZonedDateTime) = snoozeTimes(now).map { it.second }

    @Test fun offersAnHourTomorrowAtNineAndNextMondayAtNineInLocalTime() {
        // Tuesday 17 November 2026, 15:30.
        val now = at(17, 15, 30)
        assertEquals(listOf(SnoozePreset.Hour, SnoozePreset.Tomorrow, SnoozePreset.NextMonday), snoozeTimes(now).map { it.first })
        assertEquals(listOf(at(17, 16, 30), at(18, 9), at(23, 9)).map { it.toInstant() }, times(now))
    }

    @Test fun onAMondayNextMondayIsAWeekAway() {
        assertEquals(at(23, 9).toInstant(), times(at(16, 10))[2])
    }

    @Test fun onASundayTomorrowIsNextMondayOfferedOnce() {
        assertEquals(listOf(at(22, 21), at(23, 9)).map { it.toInstant() }, times(at(22, 20)))
    }

    private fun row(vararg asks: Pair<String, String?>) = AgentConversation(sessionId = "s", title = "Ops", isOwner = true,
        inputRequests = asks.mapIndexed { index, (id, until) ->
            InputRequest(id, "approval", "Ship $id?", listOf("Yes"), "2026-11-17T0$index:00:00Z", snoozedUntil = until)
        })

    private class Source(var rows: List<AgentConversation>) : OpenQuestions.Source {
        val dismissed = mutableListOf<Pair<String, String?>>()
        val snoozed = mutableListOf<Pair<String, String?>>()
        override suspend fun pending() = rows
        override suspend fun dismiss(sessionId: String, requestId: String, reason: String?) { dismissed += requestId to reason }
        override suspend fun snooze(sessionId: String, requestId: String, until: Instant?) { snoozed += requestId to until?.toString() }
    }

    @Test fun aQuestionSnoozedUntilALaterTimeLeavesTheInboxAndComesBackOnceItPasses() = runTest {
        var now = Instant.parse("2026-11-17T08:00:00Z")
        val source = Source(listOf(row("a" to null, "b" to "2026-11-17T09:00:00Z", "c" to "2026-11-17T07:00:00Z")))
        val inbox = OpenQuestions(source) { now }
        inbox.refresh()
        assertEquals(listOf("a", "c"), inbox.waiting.map { it.request.id })
        assertEquals(listOf("b"), inbox.snoozed.map { it.request.id })
        // A Bot's chat still shows it, and answers it there.
        assertEquals(listOf("a", "b", "c"), inbox.list.map { it.request.id })
        now = Instant.parse("2026-11-17T09:00:01Z")
        inbox.refresh()
        assertEquals(listOf("a", "b", "c"), inbox.waiting.map { it.request.id })
        assertTrue(inbox.snoozed.isEmpty())
    }

    @Test fun snoozingAndUnsnoozingMoveTheQuestionAtOnceAndTellTheServer() = runTest {
        val now = Instant.parse("2026-11-17T08:00:00Z")
        val source = Source(listOf(row("a" to null)))
        val inbox = OpenQuestions(source) { now }
        inbox.refresh()
        val question = inbox.waiting.single()
        inbox.snooze(question, Instant.parse("2026-11-18T01:00:00Z"), this)
        assertTrue(inbox.waiting.isEmpty())
        assertEquals(listOf("a"), inbox.snoozed.map { it.request.id })
        testScheduler.advanceUntilIdle()
        inbox.snooze(inbox.snoozed.single(), null, this)
        assertEquals(listOf("a"), inbox.waiting.map { it.request.id })
        testScheduler.advanceUntilIdle()
        assertEquals(listOf("a" to "2026-11-18T01:00:00Z", "a" to null), source.snoozed)
    }

    @Test fun aDismissalWaitsOutItsUndoThenTellsTheAgentWhy() = runTest {
        val source = Source(listOf(row("a" to null, "b" to null)))
        val inbox = OpenQuestions(source)
        inbox.refresh()
        val (a, b) = inbox.waiting
        inbox.dismiss(a, " Already shipped ", this, OpenQuestions.UNDO_MS)
        assertEquals(listOf("b"), inbox.waiting.map { it.request.id })
        assertEquals(a, inbox.held)
        testScheduler.advanceTimeBy(OpenQuestions.UNDO_MS - 1)
        assertTrue(source.dismissed.isEmpty())
        testScheduler.advanceUntilIdle()
        assertEquals(listOf("a" to "Already shipped"), source.dismissed)
        assertNull(inbox.held)
        // Undone in time: back on the list, and nothing is sent.
        inbox.dismiss(b, "", this, OpenQuestions.UNDO_MS)
        inbox.undo()
        testScheduler.advanceUntilIdle()
        assertEquals(1, source.dismissed.size)
        assertTrue(inbox.waiting.any { it.request.id == "b" })
    }

    @Test fun aDismissalsReasonIsTrimmedAndKeptWithinWhatTheServerTakes() {
        assertEquals("Use the token in CI", ai.nuphos.android.session.dismissReason("  Use the token in CI \n"))
        assertNull(ai.nuphos.android.session.dismissReason(" \n "))
        assertNull(ai.nuphos.android.session.dismissReason(null))
        assertEquals(1_000, ai.nuphos.android.session.dismissReason("a".repeat(1_200))?.length)
    }

    @Test fun aChatDismissalIsSentAtOnceWithoutAReason() = runTest {
        val source = Source(listOf(row("a" to null)))
        val inbox = OpenQuestions(source)
        inbox.refresh()
        inbox.dismiss(inbox.list.single(), null, this)
        testScheduler.runCurrent()
        assertEquals(listOf("a" to null), source.dismissed)
        assertTrue(inbox.list.isEmpty())
    }

    @Test fun theWireBodies() {
        assertEquals(JsonValue.obj("resolution" to JsonValue.Str("dismissed"), "reason" to JsonValue.Str("No longer needed")),
            ai.nuphos.android.data.AgentChatApi.dismissBody("No longer needed"))
        assertEquals(JsonValue.obj("resolution" to JsonValue.Str("dismissed")), ai.nuphos.android.data.AgentChatApi.dismissBody(null))
        assertEquals(JsonValue.obj("until" to JsonValue.Str("2026-11-18T01:00:00Z")),
            ai.nuphos.android.data.AgentChatApi.snoozeBody(Instant.parse("2026-11-18T01:00:00Z")))
        assertEquals(JsonValue.obj("until" to JsonValue.Null), ai.nuphos.android.data.AgentChatApi.snoozeBody(null))
    }
}
