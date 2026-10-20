package ai.nuphos.android

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.*
import org.junit.Assert.*
import org.junit.Test

class SentAttachmentsTest {
    private val id = "0123456789abcdef01234567"
    private fun instruction(names: String = "photo.jpg, report.txt", count: Int = 2) =
        "[The user uploaded $count file(s) to the Nuphos file-transfer store (transfer group $id): $names. To work with them, load the file-transfer skill and pull them into the sandbox: bash skills/file-transfer/scripts/transfer-pull.sh \"\$TEAM\" $id ./uploads]"
    private fun structured(wrapped: Boolean) = ChatPart.Other(JsonValue.parse(
        """{"type":"transfer-upload","groupId":"$id","status":"ready","files":[{"fileName":"photo.jpg"},{"fileName":"report.txt"}]}"""
    )!!.let { if (wrapped) JsonValue.obj("type" to JsonValue.Str("data-attachment"), "data" to it) else it })

    @Test fun legacyInstructionsBecomeCardsWithoutChangingWireOrDuplicatingInlineImages() {
        val message = ChatMessage(role = ChatMessage.Role.User, parts = listOf(ChatPart.Text(text = "Read these"),
            ChatPart.File(mediaType = "image/jpeg", filename = "photo.jpg", url = "data:image/jpeg;base64,eA=="),
            ChatPart.Text(text = instruction() + " Open and read the pulled image files before answering image questions.")))
        val before = message.forWire.parts
        val row = ChatRow.rows(listOf(message)).filterIsInstance<ChatRow.User>().single()
        assertEquals("Read these", row.text)
        assertEquals(listOf("photo.jpg", "report.txt"), row.uploads.single().names)
        assertTrue(row.images.isEmpty())
        assertEquals(before, message.forWire.parts)
        assertTrue(message.forWire.text.contains("transfer-pull.sh"))
    }

    @Test fun bothMetadataFormsAndLegacyInstructionDeduplicateByGroup() {
        for (wrapped in listOf(false, true)) {
            val display = TransferUpload.display(listOf(structured(wrapped), ChatPart.Text(text = instruction())))
            assertEquals("", display.text)
            assertEquals(1, display.uploads.size)
            val row = ChatRow.rows(listOf(ChatMessage(role = ChatMessage.Role.User, parts = listOf(structured(wrapped)))))
            assertEquals(1, row.filterIsInstance<ChatRow.User>().size)
        }
    }

    @Test fun combinedHistoryTextAndMultipleGroupsKeepUserContent() {
        val display = TransferUpload.display(listOf(ChatPart.Text(text = "My prompt\n" + instruction()),
            ChatPart.Text(text = instruction().replace(id, "abcdef0123456789abcdef01"))))
        assertEquals("My prompt", display.text)
        assertEquals(2, display.uploads.size)
    }

    @Test fun quotedMalformedCountsIdsAndOrdinaryFilenamesAreNotErased() {
        for (text in listOf("Example: " + instruction(), "\"" + instruction() + "\"", "```\n" + instruction() + "\n```",
            instruction(count = 21), instruction().replace(id, "../../private"), "Please run transfer-pull.sh and explain attachments")) {
            val result = TransferUpload.display(listOf(ChatPart.Text(text = text)))
            assertEquals(text, result.text)
            assertTrue(result.uploads.isEmpty())
        }
    }

    @Test fun legacyFilenamesContainingCommasStillResolveToAnAttachmentCard() {
        val display = TransferUpload.display(listOf(ChatPart.Text(text = instruction("report, draft.txt", 1))))
        assertEquals("", display.text)
        assertEquals(listOf("report, draft.txt"), display.uploads.single().names)
    }

    @Test fun malformedMetadataDoesNotCreateFetchableGroups() {
        for (raw in listOf(
            """{"type":"transfer-upload","groupId":"../../auth","files":[{"fileName":"a.txt"}]}""",
            """{"type":"transfer-upload","groupId":"$id","status":"pending","files":[{"fileName":"a.txt"}]}""",
            """{"type":"transfer-upload","groupId":"$id","files":[]}""")) {
            assertTrue(TransferUpload.display(listOf(ChatPart.Other(JsonValue.parse(raw)!!))).uploads.isEmpty())
        }
    }
}
