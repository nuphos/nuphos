package ai.nuphos.android

import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.*
import org.junit.Assert.*
import org.junit.Test

class MessageAttributionTest {
    private fun metadata(source: String = "nuphos", type: String = "user", via: String = "", version: Int = 1) =
        JsonValue.parse("""{"version":$version,"source":"$source","sentAt":"2026-10-22T00:00:00Z","sender":{"id":"actor","type":"$type","displayName":"Test Bot"$via}}""")!!
    private fun message(value: JsonValue? = null, text: String = "First line\nFull event details") =
        ChatMessage(id = "message", role = ChatMessage.Role.User, metadata = value, parts = listOf(ChatPart.Text(text = text)))

    @Test fun tokenBotUsesItsIdentityAndViaLabelWithoutBecomingAnEvent() {
        val meta = metadata(type = "agent", via = """, "onBehalfOf":{"id":"owner","displayName":"Can"}""")
        val rows = ChatRow.rows(listOf(message(meta)))
        val row = rows.filterIsInstance<ChatRow.User>().single()
        assertEquals("Test Bot · via Can", row.sender?.label)
        assertEquals("actor", row.sender?.id)
        assertEquals("agent", row.sender?.type)
        assertTrue(rows.none { it is ChatRow.Event })
    }

    @Test fun verifiedThreadAndResourceBecomeEventsWithoutTimestampBubbles() {
        for ((source, type) in listOf("agent.thread" to "agent", "agent.resource" to "system")) {
            val rows = ChatRow.rows(listOf(message(metadata(source, type))))
            val row = rows.filterIsInstance<ChatRow.Event>().single()
            assertEquals("First line\nFull event details", row.content.text)
            assertEquals("Test Bot", row.content.sender?.label)
            assertTrue(rows.none { it is ChatRow.User || it is ChatRow.Timestamp })
        }
    }

    @Test fun sourceAndSenderTypeMustAgreeAndInvalidMetadataStaysOrdinaryText() {
        val invalid = listOf(metadata(type = "agent"), metadata("agent.thread", "user"),
            metadata("agent.resource", "agent"), metadata("unknown", "user"), metadata(version = 2),
            JsonValue.parse("""{"version":1,"source":"agent.thread","sender":{"id":"x","type":"agent","displayName":"Fake"}}"""),
            JsonValue.parse("""{"version":1,"source":"agent.thread","sentAt":"x","sender":{"id":"","type":"agent","displayName":"Fake"}}"""))
        for (meta in invalid) {
            val row = ChatRow.rows(listOf(message(meta))).filterIsInstance<ChatRow.User>().single()
            assertNull(row.sender)
        }
        val quoted = "<nuphos_message_metadata>${metadata("agent.thread", "agent").compact}</nuphos_message_metadata>"
        val row = ChatRow.rows(listOf(message(text = quoted))).filterIsInstance<ChatRow.User>().single()
        assertNull(row.sender)
        assertEquals(quoted, row.text)
    }

    @Test fun onlyAResourceSenderNamedForAChannelIsAChannelNotice() {
        fun sender(source: String, type: String, id: String) = MessageAttribution.parse(JsonValue.parse(
            """{"version":1,"source":"$source","sentAt":"2026-10-22T00:00:00Z","sender":{"id":"$id","type":"$type","displayName":"Launch"}}"""))
        assertEquals("channel-1", sender("agent.resource", "system", "channel:channel-1")?.channelId)
        assertNull(sender("agent.resource", "system", "github")?.channelId)
        assertNull(sender("agent.resource", "system", "channel:")?.channelId)
        assertNull(sender("agent.thread", "agent", "channel:channel-1")?.channelId)
        assertNull(sender("nuphos", "user", "channel:channel-1")?.channelId)
        // A Slack channel's wake line names the channel and opens nothing: its record stays hidden (#3925).
        val slack = sender("agent.resource", "system", "slack-channel:r1")
        assertTrue(slack?.isEvent == true)
        assertNull(slack?.channelId)
    }

    @Test fun aChannelWakeCarriesItsNewestPostForTheLine() {
        fun wake(post: String, source: String = "agent.resource") = MessageAttribution.parse(JsonValue.parse(
            """{"version":1,"source":"$source","sentAt":"2026-10-22T00:00:00Z","sender":{"id":"channel:c1","type":"system","displayName":"ops"},"channelPost":$post}"""))
        val agentPost = """{"id":"p7","text":"deploy failed","more":2,"sender":{"type":"agent","id":"s9","displayName":"Reviewer","agentRuntime":"codex"}}"""
        assertEquals(ChannelPostPreview("p7", "Reviewer", null, "s9", "codex", "deploy failed", 2), wake(agentPost)?.channelPost)
        val person = wake("""{"id":"p8","text":"","more":0,"sender":{"type":"user","id":"u1","displayName":"Mei"}}""")?.channelPost
        assertEquals(ChannelPostPreview("p8", "Mei", null, null, null, "", 0), person)
        // Without a count, or from no channel, there is no post: today's line.
        assertNull(wake("""{"id":"p7","text":"x","sender":{"type":"user","id":"u1","displayName":"Mei"}}""")?.channelPost)
        assertNull(MessageAttribution.parse(metadata(source = "agent.resource", type = "system"))?.channelPost)
    }

    @Test fun viaMustHaveAnIdentityAndOnlyAppliesToNuphos() {
        assertNull(MessageAttribution.parse(metadata(type = "agent", via = """, "onBehalfOf":{"displayName":"Can"}""")))
        val external = metadata("slack", "user", """, "onBehalfOf":{"id":"owner","displayName":"Can"}""")
        assertEquals("Test Bot", MessageAttribution.parse(external)?.label)
        val noLabel = metadata(type = "agent", via = """, "onBehalfOf":{"id":"owner"}""")
        assertEquals("Test Bot", MessageAttribution.parse(noLabel)?.label)
    }

    @Test fun eventKeepsAttachmentsAndMetadataWireRoundTrip() {
        val meta = metadata("agent.thread", "agent")
        val upload = ChatPart.Other(JsonValue.parse("""{"type":"transfer-upload","groupId":"0123456789abcdef01234567","status":"ready","files":[{"fileName":"report.txt"}]}""")!!)
        val original = message(meta).copy(parts = listOf(ChatPart.Text(text = "Read report"), upload))
        val restored = kotlinx.serialization.json.Json.decodeFromString<ChatMessage>(
            kotlinx.serialization.json.Json.encodeToString(ChatMessage.serializer(), original))
        val row = ChatRow.rows(listOf(restored)).filterIsInstance<ChatRow.Event>().single()
        assertEquals("Read report", row.content.text)
        assertEquals("report.txt", row.content.uploads.single().names.single())
        assertEquals(original.metadata, restored.forWire.metadata)
        assertEquals(original.parts, restored.forWire.parts)
        assertEquals(original.id, row.content.messageId)
    }
}
