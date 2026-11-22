package ai.nuphos.android

import ai.nuphos.android.data.*
import ai.nuphos.android.model.*
import ai.nuphos.android.model.ReplyFiles.Segment
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class ReplyFilesTest {
    private val id = "0123456789abcdef01234567"
    private val other = "fedcba9876543210fedcba98"

    @Test fun aLineOfCitationsBecomesTheirGroups() {
        val text = "Here it is:\n\n![shot](https://nuphos.ai/_reply-images/$id) ![clip](https://nuphos.ai/_reply-images/$other)\n\nDone."
        assertEquals(listOf(Segment.Text("Here it is:\n"), Segment.Files(id), Segment.Files(other), Segment.Text("\nDone.")),
            ReplyFiles.segments(text))
    }

    @Test fun otherHostsShortIdsExtraPathsInlineAndCodeStayMarkdown() {
        listOf(
            "![x](https://example.com/_reply-images/$id)",
            "![x](https://nuphos.ai/_reply-images/0123)",
            "![x](https://nuphos.ai/_reply-images/$id/more)",
            "See ![x](https://nuphos.ai/_reply-images/$id) here",
            "```\n![x](https://nuphos.ai/_reply-images/$id)\n```",
            "    ![x](https://nuphos.ai/_reply-images/$id)",
        ).forEach { assertEquals(it, listOf(Segment.Text(it)), ReplyFiles.segments(it)) }
    }

    @Test fun aCitedGroupShowsWhereItIsCitedAndNotAgainBelow() {
        val start = Instant.parse("2026-10-26T00:00:00Z")
        val reply = ChatMessage(id = "one", role = ChatMessage.Role.Assistant, createdAt = start,
            parts = listOf(ChatPart.Text(text = "Before\n![shot](https://nuphos.ai/_reply-images/$id)\nAfter")))
        val cited = TransferDownloadGroup(id, "2030-01-01T00:00:00Z", listOf(TransferDownloadFile("f", "shot.png", "ready")), start.toString())
        val rows = ChatRow.rows(listOf(reply), downloads = listOf(cited))
        val shown = rows.filter { it is ChatRow.AssistantText || it is ChatRow.Downloads }
        assertEquals(listOf("Before", null, "After"), shown.map { (it as? ChatRow.AssistantText)?.text })
        assertEquals(listOf(cited), rows.filterIsInstance<ChatRow.Downloads>().map { it.group })
    }

    @Test fun anExpiredCitationStillGetsItsCard() {
        val reply = ChatMessage(id = "one", role = ChatMessage.Role.Assistant, createdAt = Instant.EPOCH,
            parts = listOf(ChatPart.Text(text = "![shot](https://nuphos.ai/_reply-images/$id)")))
        val card = ChatRow.rows(listOf(reply)).filterIsInstance<ChatRow.Downloads>().single()
        assertEquals(id, card.group.groupId)
        assertTrue(card.group.files.isEmpty())
    }
}
