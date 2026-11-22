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
            "\t![x](https://nuphos.ai/_reply-images/$id)",
            "![x](https://nuphos.ai/_reply-images/${id.uppercase()})",
            // A shorter run, or a run followed by text, does not close a fence.
            "````\n```\n![x](https://nuphos.ai/_reply-images/$id)\n````",
            "```\n``` not a close\n![x](https://nuphos.ai/_reply-images/$id)\n```",
            "~~~\n```\n![x](https://nuphos.ai/_reply-images/$id)\n~~~",
            // A fence that opens a list item or a block quote.
            "- ~~~\n  ![example](https://nuphos.ai/_reply-images/$id)\n  ~~~",
            "1. ```\n   ![example](https://nuphos.ai/_reply-images/$id)\n   ```",
            "> ```\n> ![example](https://nuphos.ai/_reply-images/$id)\n> ```",
            // A blank line inside a list item's fence, or less indent at the top level, keeps it open.
            "- ~~~\n  a\n\n  ![example](https://nuphos.ai/_reply-images/$id)\n  ~~~",
            "  ~~~\n![example](https://nuphos.ai/_reply-images/$id)\n  ~~~",
            // List and block quote markers inside a fence are code, so they do not close it.
            "~~~\n- ~~~\n![example](https://nuphos.ai/_reply-images/$id)\n~~~",
            "~~~\n> ~~~\n![example](https://nuphos.ai/_reply-images/$id)\n~~~",
            "> ~~~\n> > ~~~\n> ![example](https://nuphos.ai/_reply-images/$id)\n> ~~~",
            // An unterminated fence runs to the end.
            "```kotlin\n![x](https://nuphos.ai/_reply-images/$id)",
        ).forEach { assertEquals(it, listOf(Segment.Text(it)), ReplyFiles.segments(it)) }
    }

    @Test fun aClosedFenceCrlfTrailingSpaceAndEmptyCaptionStillCite() {
        assertEquals(listOf(Segment.Text("```\r\ncode\r\n``` \r"), Segment.Files(id)),
            ReplyFiles.segments("```\r\ncode\r\n``` \r\n![](https://nuphos.ai/_reply-images/$id) \t\r"))
        assertEquals(listOf(Segment.Files(id)), ReplyFiles.segments("   ![](https://nuphos.ai/_reply-images/$id)"))
        assertEquals(listOf(Segment.Text("- ~~~\n  x\n  ~~~"), Segment.Files(id)),
            ReplyFiles.segments("- ~~~\n  x\n  ~~~\n![](https://nuphos.ai/_reply-images/$id)"))
    }

    @Test fun aFenceEndsWithTheBlockQuoteOrListItemItOpenedIn() {
        val cite = "![](https://nuphos.ai/_reply-images/$id)"
        assertEquals(listOf(Segment.Text("> ~~~\n> sample code\n"), Segment.Files(id)),
            ReplyFiles.segments("> ~~~\n> sample code\n\n$cite"))
        assertEquals(listOf(Segment.Text("- ```\n  code"), Segment.Files(id)), ReplyFiles.segments("- ```\n  code\n$cite"))
        assertEquals(listOf(Segment.Text("- item\n  ~~~\n  code\n"), Segment.Files(id)),
            ReplyFiles.segments("- item\n  ~~~\n  code\n\n$cite"))
    }

    @Test fun aStreamingCitationKeepsTheCardBelowUntilItsRowShows() {
        val start = Instant.parse("2026-10-26T00:00:00Z")
        val group = TransferDownloadGroup(id, "2030-01-01T00:00:00Z", listOf(TransferDownloadFile("f", "shot.png", "ready")), start.toString())
        fun reply(state: ChatPart.StreamState?) = ChatMessage(id = "one", role = ChatMessage.Role.Assistant, createdAt = start,
            parts = listOf(ChatPart.Text(text = "![shot](https://nuphos.ai/_reply-images/$id)", state = state)))
        val streaming = ChatRow.rows(listOf(reply(ChatPart.StreamState.Streaming)), isStreaming = true, downloads = listOf(group))
        assertEquals(listOf(group), streaming.filterIsInstance<ChatRow.Downloads>().map { it.group })
        assertTrue(streaming.filterIsInstance<ChatRow.AssistantText>().single().text.contains("_reply-images"))
        val done = ChatRow.rows(listOf(reply(ChatPart.StreamState.Done)), downloads = listOf(group))
        assertEquals(listOf(group), done.filterIsInstance<ChatRow.Downloads>().map { it.group })
        assertTrue(done.none { it is ChatRow.AssistantText })
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
