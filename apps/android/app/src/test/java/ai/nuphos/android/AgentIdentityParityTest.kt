package ai.nuphos.android

import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.BotAvatars
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test

class AgentIdentityParityTest {
    @Test fun sharedIdentityFixtureMatchesIOSAndDesktop() {
        val text = javaClass.getResource("/bot-avatars.json")!!.readText()
        for (row in Json.parseToJsonElement(text).jsonArray) {
            val fields = row.jsonObject
            assertEquals(fields.getValue("file").jsonPrimitive.content,
                BotAvatars.file(fields.getValue("id").jsonPrimitive.content))
        }
    }

    @Test fun listKeepsRuntimeIdentityAndOlderResponsesStillDecode() {
        val json = Json { ignoreUnknownKeys = true }
        val row = json.decodeFromString(AgentConversation.serializer(), """
            {"sessionId":"shared-agent","agentRuntime":"codex","runtimeId":"local-runtime","runtimeLabel":"Studio laptop"}
        """)
        assertEquals("codex", row.agentRuntime)
        assertEquals("local-runtime", row.runtimeId)
        assertEquals("Studio laptop", row.runtimeLabel)
        val older = json.decodeFromString(AgentConversation.serializer(), """{"sessionId":"legacy"}""")
        assertNull(older.agentRuntime)
        assertNull(older.runtimeLabel)
    }
}
