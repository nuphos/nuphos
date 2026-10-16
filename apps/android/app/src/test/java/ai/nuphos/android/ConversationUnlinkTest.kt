package ai.nuphos.android

import ai.nuphos.android.data.ConversationActions
import ai.nuphos.android.data.JsonValue
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class ConversationUnlinkTest {
    @Test fun usesOwnerParentDeleteContractWithEncodedSessionAndScopedTeam() = runBlocking {
        var calls = 0
        ConversationActions.unlinkParent("synthetic", "team /", "child /?") { method, path, token, query, body ->
            calls++
            assertEquals("DELETE", method)
            assertEquals("agent/conversations/child%20%2F%3F/parent", path)
            assertEquals("synthetic", token)
            assertEquals(listOf("teamId" to "team /"), query)
            assertNull(body)
            """{"ok":true,"parentSessionId":null}"""
        }
        assertEquals(1, calls)
    }
    @Test fun malformedAndUnconfirmedResponsesNeverCountAsSuccess() = runBlocking {
        for (response in listOf("{}", "null", "not json", """{"ok":true}""", """{"ok":false,"parentSessionId":null}""", """{"ok":true,"parentSessionId":"parent"}""")) {
            assertTrue(runCatching {
                ConversationActions.unlinkParent("synthetic", "A", "child") { _, _, _, _, _ -> response }
            }.isFailure)
        }
    }
    @Test fun failurePropagatesWithoutRetryOrOtherMutation() = runBlocking {
        var calls = 0
        val failure = IllegalStateException("403 synthetic denied")
        val result = runCatching { ConversationActions.unlinkParent("synthetic", "A", "child") { _, _, _, _, _ ->
            calls++; throw failure
        } }
        assertSame(failure, result.exceptionOrNull())
        assertEquals(1, calls)
    }
}
