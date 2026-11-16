package ai.nuphos.android

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.*
import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class AnsweredQuestionTest {
    private val by = """Answered by: "Sam \"S\" Rivera", this conversation's owner: it is their own answer."""
    private fun notice(vararg lines: String, sender: String = "nuphos:decision") = ChatMessage(
        id = "notice", role = ChatMessage.Role.User, parts = listOf(ChatPart.Text(text = lines.joinToString("\n"))),
        metadata = JsonValue.parse("""{"version":1,"source":"agent.resource","sentAt":"2026-11-14T01:47:00Z","sender":{"id":"$sender","type":"system","displayName":"Nuphos"}}"""),
    )
    private val lines = arrayOf(
        "Your question (requestId q1) was answered from the Inbox.", by,
        "Question: Which region?", "Context you gave: Two candidates.", "", "Answer:", "- cut short",
        "Options: us-east | eu-west", "Answer:", "- Which region? → eu-west",
        "About: 3f0c9d0e-1111-2222-3333-444455556666", "Continue the task with this answer.",
    )

    @Test fun aNoticeWithoutItsCardShowsWhatTheNoticeCarriesAndNoIds() {
        val rows = ChatRow.rows(listOf(notice(*lines)))
        val row = rows.filterIsInstance<ChatRow.Answered>().single().question
        assertEquals("Sam \"S\" Rivera", row.name)
        assertEquals("Which region?", row.question)
        assertEquals("eu-west", row.answer)
        assertEquals("Two candidates.\n\nAnswer:\n- cut short", row.body)
        assertEquals(listOf("us-east", "eu-west"), row.options)
        assertEquals(listOf("eu-west"), row.picked)
        assertTrue(rows.none { it is ChatRow.Event || it is ChatRow.User || it is ChatRow.Timestamp })
    }

    @Test fun theCardGivesEachQuestionItsOptionsTheWholeBodyAndWhenItWasAsked() {
        val input = JsonValue.parse("""{"question":"Release settings","body":"The whole body.","questions":[
            {"question":"Which platforms?","options":["Desktop","iOS, iPadOS","Android"],"multiSelect":true},
            {"question":"Notes?","options":["None"]}]}""")
        val asked = ChatMessage(id = "ask", role = ChatMessage.Role.Assistant, createdAt = Instant.ofEpochSecond(100), parts = listOf(
            ChatPart.Tool("call-1", "request_user_decision", true, ChatPart.Tool.State.OutputAvailable, input, output = JsonValue.parse("""{"requestId":"q2"}""")),
        ))
        val several = notice(
            "Your question (requestId q2) was answered from the Inbox.", by, "Question: Release settings",
            "Context you gave: The whole", "Answer:", "- Which platforms? → iOS, iPadOS, Desktop", "- Notes? → Ship it", "on Friday.",
            "Continue the task with this answer.",
        )
        val answered = ChatRow.rows(listOf(asked, several)).filterIsInstance<ChatRow.Answered>().map { it.question }
        assertEquals(listOf("Which platforms?", "Notes?"), answered.map { it.question })
        assertEquals(listOf("iOS, iPadOS, Desktop", "Ship it\non Friday."), answered.map { it.answer })
        assertTrue(answered.all { it.body == "The whole body." && it.asked == asked.createdAt })
        assertEquals(listOf("Desktop", "iOS, iPadOS"), answered[0].picked)
        assertTrue(answered[1].picked.isEmpty())
    }

    @Test fun anyOtherMessageStaysAnEvent() {
        assertTrue(ChatRow.rows(listOf(notice("Your question (requestId q1) was withdrawn."))).any { it is ChatRow.Event })
        assertTrue(ChatRow.rows(listOf(notice(*lines, sender = "github"))).any { it is ChatRow.Event })
    }

    @Test fun anAnswerStillWaitingForItsAgentSaysWhyUnderItsLine() {
        val note = "Answered · waiting for Claude Code (out of usage until 11:20 UTC)"
        val rows = ChatRow.rows(listOf(notice(*lines)), waiting = mapOf("q1" to note))
        val at = rows.indexOfFirst { it is ChatRow.Answered }
        assertEquals(ChatRow.Hint("waiting.notice", note, false), rows[at + 1])
        // Delivered: nothing waits, no line.
        assertTrue(ChatRow.rows(listOf(notice(*lines))).none { it is ChatRow.Hint })
    }
}
