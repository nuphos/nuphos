package ai.nuphos.android.data

import kotlinx.coroutines.test.runTest
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

class ModelSettingsApiTest {
    private val response = """{"status":"dormant","options":[{"id":"model","name":"Model","kind":"model","currentValue":"a","options":[{"value":"a","name":"Alpha"}]}]}"""
    @Test fun runtimePreviewGetHasSelectionQueryAndNoMutation() = runTest {
        ModelSettingsApi.newConfig("synthetic", "team", "agent /", mapOf("model" to "a", "fast" to "off")) { method, path, token, query, body ->
            assertEquals("GET", method); assertEquals("teams/team/agent-runtimes/agent%20%2F/model-config", path)
            assertEquals("synthetic", token); assertEquals(mapOf("model" to "a", "fast" to "off"), query.toMap()); assertNull(body)
            response
        }
    }
    @Test fun existingReadAndPatchUseTeamScopeAndOpaqueConfigId() = runTest {
        ModelSettingsApi.read("synthetic", "team", "chat /?") { method, path, _, query, body ->
            assertEquals("GET", method); assertEquals("agent/conversations/chat%20%2F%3F/model-config", path)
            assertEquals(listOf("teamId" to "team"), query); assertNull(body); response
        }
        ModelSettingsApi.write("synthetic", "team", "chat", "reasoning_effort", "high") { method, path, _, query, body ->
            assertEquals("PATCH", method); assertEquals("agent/conversations/chat/model-config", path)
            assertEquals(listOf("teamId" to "team"), query)
            assertEquals("reasoning_effort", body?.get("configId")?.stringValue); assertEquals("high", body?.get("value")?.stringValue); response
        }
    }
    @Test fun unknownStatusAndMalformedCapabilitiesFailClosed() = runTest {
        for (raw in listOf("{}", """{"status":"unknown","options":[]}""", """{"status":"ready","options":[{"id":"tools","kind":"tools","name":"Tools","currentValue":"all","options":[]}]}""")) {
            assertTrue(runCatching { ModelSettingsApi.read("synthetic", "team", "chat") { _, _, _, _, _ -> raw } }.isFailure)
        }
    }
    @Test fun initialSettingsCoexistWithExplicitCredentialSelectionAndRuntimeBinding() {
        val credential = ai.nuphos.android.model.CredentialSelection(newConversation = true).json
        val request = AgentChatApi.ChatRequest("new", "team", emptyList(), streamId = "s", credentialAccess = credential,
            runtimeId = "agent", agentRuntime = "codex", initialSessionConfig = mapOf("model" to "a", "effort" to "high", "fast" to "off"))
        val buffer = Buffer(); AgentChatApi.chatRequest("synthetic", request).body!!.writeTo(buffer)
        val body = JsonValue.parse(buffer.readUtf8())!!
        assertEquals("a", body["initialSessionConfig"]?.get("model")?.stringValue)
        assertEquals(credential, body["credentialAccess"]); assertEquals("agent", body["runtimeId"]?.stringValue)
        val explicit = body["credentialAccess"] as JsonValue.Obj
        assertEquals(30, explicit.value.size)
        assertTrue(explicit.value.values.all { it.arrayValue?.isEmpty() == true })
        val resumed = request.copy(resume = true, initialSessionConfig = null)
        val other = Buffer(); AgentChatApi.chatRequest("synthetic", resumed).body!!.writeTo(other)
        assertNull(JsonValue.parse(other.readUtf8())!!["initialSessionConfig"])
    }
}
