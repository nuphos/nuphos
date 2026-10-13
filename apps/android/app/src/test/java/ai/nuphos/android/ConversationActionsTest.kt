package ai.nuphos.android

import ai.nuphos.android.data.ConversationActions
import ai.nuphos.android.data.JsonValue
import org.junit.Assert.*
import org.junit.Test
import ai.nuphos.android.data.Http
import kotlinx.coroutines.runBlocking

class ConversationActionsTest {
    @Test fun conflictRefreshPreservesConcurrentFavoritesAndOnlyRetriesOnce() = runBlocking {
        val writes = mutableListOf<JsonValue>()
        var reads = 0
        val result = ConversationActions.pin("fixture", "team", "s", "Chat", true) { method, path, _, _, body ->
            assertEquals("teams/team/favorites", path)
            if (method == "GET") {
                reads++
                "{\"revision\":$reads,\"entries\":[{\"label\":\"Other\",\"href\":\"/other-$reads\"}]}"
            } else {
                writes += body!!
                if (writes.size == 1) throw ai.nuphos.android.data.AgentChatApi.Conflict.Other("sidebar_favorites_changed", "refresh", 409)
                "{\"revision\":3,\"entries\":${Http.json.encodeToString(JsonValue.serializer(), body["entries"]!!)}}"
            }
        }
        assertEquals(2, reads); assertEquals(2, writes.size)
        assertEquals(2.0, writes.last()["expectedRevision"]!!.numberValue)
        assertEquals("/other-2", result.entries.first()["href"]!!.stringValue)
        assertTrue(result.contains("s"))
    }
    @Test fun failedFavoritesReadNeverWritesEmptyReplacement() = runBlocking {
        var writes = 0
        val result = runCatching {
            ConversationActions.pin("fixture", "team", "s", "Chat", true) { method, _, _, _, _ ->
                if (method != "GET") writes++
                throw IllegalStateException("unavailable")
            }
        }
        assertTrue(result.isFailure); assertEquals(0, writes)
    }
    @Test fun pinPreservesOtherFavoritesAndTruncatesLabel() {
        val other = JsonValue.obj("label" to JsonValue.Str("Dashboard"), "href" to JsonValue.Str("/dashboard"))
        val result = ConversationActions.pinnedEntries(listOf(other), "session", "x".repeat(230), true)
        assertEquals(other, result.first())
        assertEquals(200, result.last()["label"]!!.stringValue!!.length)
        assertEquals("agent-session:session", result.last()["key"]!!.stringValue)
        assertEquals(listOf(other), ConversationActions.pinnedEntries(result, "session", "Chat", false))
    }
    @Test fun pinDoesNotDuplicateExistingEntry() {
        val row = JsonValue.obj("label" to JsonValue.Str("Old"), "key" to JsonValue.Str("agent-session:s"))
        assertEquals(listOf(row), ConversationActions.pinnedEntries(listOf(row), "s", "New", true))
    }
    @Test fun shareEscapesSegmentsAndRejectsEmptyIdentity() {
        assertEquals("https://nuphos.ai/teams/a%2Fb/agent/s%20%3F%23", ConversationActions.shareUrl("a/b", "s ?#"))
        assertNull(ConversationActions.shareUrl("", "s"))
    }
    @Test fun titleRequiresTrimmedNonemptyBoundedValue() {
        assertEquals("Chat", ConversationActions.validTitle(" Chat "))
        assertNull(ConversationActions.validTitle(" "))
        assertNull(ConversationActions.validTitle("x".repeat(121)))
    }
}
