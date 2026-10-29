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
    @Test fun desktopHrefIdentityMatchesKeyAndUnpinPreservesUnrelatedEntries() {
        val href = JsonValue.obj("label" to JsonValue.Str("Desktop pin"), "href" to JsonValue.Str("https://nuphos.ai/teams/team/agent/s%2B%20x"))
        val key = JsonValue.obj("key" to JsonValue.Str("agent-session:s+ x"))
        val other = JsonValue.obj("href" to JsonValue.Str("/teams/team/plans/plan"))
        assertEquals("s+ x", ConversationActions.favoriteSessionId(href))
        assertTrue(ConversationActions.Favorites(listOf(href), 1).contains("s+ x"))
        assertEquals(listOf(href, other), ConversationActions.pinnedEntries(listOf(href, other), "s+ x", "New", true))
        assertEquals(listOf(other), ConversationActions.pinnedEntries(listOf(href, key, other), "s+ x", "New", false))
        assertEquals("a+b", ConversationActions.favoriteSessionId(JsonValue.obj("href" to JsonValue.Str("/teams/t/agent/a+b"))))
    }
    @Test fun unrelatedMalformedAndEmptyFavoriteRoutesAreNotChatPins() {
        for (href in listOf("/dashboard", "/teams/t/agent", "/teams/t/agent/", "/teams//agent/s", "/teams/t/agent/s/extra", "/teams/t/agent/%ZZ"))
            assertNull(href, ConversationActions.favoriteSessionId(JsonValue.obj("href" to JsonValue.Str(href))))
        val preferred = JsonValue.obj("key" to JsonValue.Str("agent-session:key"), "href" to JsonValue.Str("/teams/t/agent/href"))
        assertEquals("key", ConversationActions.favoriteSessionId(preferred))
    }

    @Test fun favoriteHrefMustMatchCanonicalOriginAndRequestedTeam() {
        fun entry(href: String) = JsonValue.obj("href" to JsonValue.Str(href))
        assertEquals("s", ConversationActions.favoriteSessionId(entry("/teams/A/agent/s"), "A"))
        assertEquals("s", ConversationActions.favoriteSessionId(entry("https://nuphos.ai/teams/A/agent/s"), "A"))
        for (href in listOf("https://example.com/teams/A/agent/s", "//nuphos.ai/teams/A/agent/s", "http://nuphos.ai/teams/A/agent/s", "https://user@nuphos.ai/teams/A/agent/s", "https://nuphos.ai:444/teams/A/agent/s", "/teams/B/agent/s", "/teams/A/agent/s?teamId=B", "/teams/A/agent/s#x"))
            assertNull(href, ConversationActions.favoriteSessionId(entry(href), "A"))
        val foreign = entry("/teams/B/agent/s")
        assertFalse(ConversationActions.Favorites(listOf(foreign), 1, "A").contains("s"))
        assertEquals(listOf(foreign), ConversationActions.pinnedEntries(listOf(foreign), "s", "Chat", false, "A"))
        assertEquals(2, ConversationActions.pinnedEntries(listOf(foreign), "s", "Chat", true, "A").size)
    }

}
