package ai.nuphos.android.session

import ai.nuphos.android.data.AgentChatApi
import ai.nuphos.android.data.RuntimeBinding
import kotlinx.serialization.json.*
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.resetMain
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class RuntimeCreationBindingTest {
    @org.junit.Before fun setup() { kotlinx.coroutines.Dispatchers.setMain(kotlinx.coroutines.test.UnconfinedTestDispatcher()) }
    @org.junit.After fun cleanup() { kotlinx.coroutines.Dispatchers.resetMain() }
    private val binding = RuntimeBinding("exact-id", "codex")
    @Test fun freshCapturesPreferenceWithoutPresettingNativeAdmission() {
        val session = ChatSession.fresh("synthetic", "team", binding)
        assertEquals(binding, session.creationRuntimeBinding)
        assertEquals(binding, session.outgoingCreationBinding)
        assertNull(session.agentRuntime); assertFalse(session.isNative)
        assertNull(ChatSession("synthetic", "team", sessionId = "existing").outgoingCreationBinding)
    }
    @Test fun requestSerializesBothExactFieldsAndDefaultOmitsThem() {
        fun body(runtime: RuntimeBinding?) = AgentChatApi.chatRequest("synthetic", AgentChatApi.ChatRequest(
            "new", "team", emptyList(), streamId = "stream", runtimeId = runtime?.runtimeId, agentRuntime = runtime?.agentRuntime))
            .body!!.let { Buffer().also(it::writeTo).readUtf8() }.let { Json.parseToJsonElement(it).jsonObject }
        val explicit = body(binding)
        assertEquals("exact-id", explicit["runtimeId"]?.jsonPrimitive?.content)
        assertEquals("codex", explicit["agentRuntime"]?.jsonPrimitive?.content)
        assertFalse(body(null).containsKey("runtimeId")); assertFalse(body(null).containsKey("agentRuntime"))
    }
    @Test fun savedServerMetadataEndsCreationPreferenceWithoutChangingIt() = kotlinx.coroutines.test.runTest {
        val session = ChatSession("synthetic", "team", creationRuntimeBinding = binding,
            aiAllowed = { true }, readDetail = { _, _, _ -> ai.nuphos.android.model.AgentConversationDetail(agentRuntime = "claude-code", messages = emptyList()) })
        assertEquals(binding, session.outgoingCreationBinding)
        session.load()
        assertEquals("claude-code", session.agentRuntime)
        assertNull(session.outgoingCreationBinding)
        assertEquals(binding, session.creationRuntimeBinding)
        session.disposeForConsent()
    }

}
