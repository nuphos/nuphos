package ai.nuphos.android

import ai.nuphos.android.data.ConversationActions
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.AgentConversationDetail
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class ConversationWatchTest {
    @Test fun optionalFieldPreservesFalseAndOldServerCompatibility() {
        val json = Json { ignoreUnknownKeys = true }
        assertNull(json.decodeFromString<AgentConversation>("""{"sessionId":"old","future":true}""").watching)
        assertNull(json.decodeFromString<AgentConversationDetail>("{}").watching)
        assertFalse(json.decodeFromString<AgentConversation>("""{"sessionId":"shared","isOwner":false,"readOnly":true,"watching":false}""").watching!!)
        assertTrue(json.decodeFromString<AgentConversationDetail>("""{"watching":true,"unknown":{}}""").watching!!)
    }
    @Test fun watchAndUnwatchUseScopedEncodedBodylessContract() = runBlocking {
        for (watching in listOf(true, false)) {
            var calls = 0
            assertEquals(watching, ConversationActions.watch("synthetic", "team /", "shared /?", watching) { method, path, token, query, body ->
                calls++
                assertEquals(if (watching) "PUT" else "DELETE", method)
                assertEquals("agent/conversations/shared%20%2F%3F/watch", path)
                assertEquals("synthetic", token)
                assertEquals(listOf("teamId" to "team /"), query)
                assertNull(body)
                """{"ok":true,"watching":$watching,"future":1}"""
            })
            assertEquals(1, calls)
        }
    }
    @Test fun invalidOrMismatchedConfirmationFailsWithoutAutomaticRetry() = runBlocking {
        for (response in listOf("not json", "{}", "null", """{"ok":false,"watching":true}""", """{"ok":true,"watching":false}""", """{"ok":true}""")) {
            var calls = 0
            assertTrue(runCatching { ConversationActions.watch("synthetic", "A", "chat", true) { _, _, _, _, _ -> calls++; response } }.isFailure)
            assertEquals(1, calls)
        }
    }
    @Test fun failedTransportCanBeExplicitlyRetried() = runBlocking {
        var calls = 0
        val request: suspend (String, String, String, List<Pair<String, String>>, ai.nuphos.android.data.JsonValue?) -> String = { _, _, _, _, _ ->
            if (++calls == 1) error("synthetic network failure")
            """{"ok":true,"watching":false}"""
        }
        assertTrue(runCatching { ConversationActions.watch("synthetic", "A", "chat", false, request) }.isFailure)
        assertFalse(ConversationActions.watch("synthetic", "A", "chat", false, request))
        assertEquals(2, calls)
    }
}
