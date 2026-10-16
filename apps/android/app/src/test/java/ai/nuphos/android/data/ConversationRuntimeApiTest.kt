package ai.nuphos.android.data

import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class ConversationRuntimeApiTest {
    private val target = AgentRuntime("new", "codex", "New", "active", "managed")
    private val binding = RuntimeBinding("new", "codex", "New")
    @Test fun sameProviderPreservesWorkspace() = runTest {
        val modes = mutableListOf<String>()
        assertEquals(binding, ConversationRuntimeApi.moveWithFallback(target, "codex") { modes += it; binding })
        assertEquals(listOf("workspace"), modes)
    }
    @Test fun onlyUnavailableWorkspaceFallsBackToHistory() = runTest {
        val modes = mutableListOf<String>()
        ConversationRuntimeApi.moveWithFallback(target, "codex") {
            modes += it
            if (it == "workspace") throw AgentChatApi.Conflict.Other("workspace_unavailable", "Unavailable", 409)
            binding
        }
        assertEquals(listOf("workspace", "history"), modes)
        for (failure in listOf(AgentChatApi.Conflict.Other("runtime_starting", "Starting", 409),
            AgentChatApi.Conflict.Other("workspace_unavailable", "Denied", 403))) {
            var calls = 0
            try {
                ConversationRuntimeApi.moveWithFallback(target, "codex") { calls++; throw failure }
                fail("Should fail")
            } catch (e: AgentChatApi.Conflict.Other) { assertSame(failure, e) }
            assertEquals(1, calls)
        }
    }
    @Test fun crossProviderAndLocalUseHistory() = runTest {
        for ((runtime, source) in listOf(target to "claude-code", target.copy(kind = "local") to "codex")) {
            val modes = mutableListOf<String>()
            ConversationRuntimeApi.moveWithFallback(runtime, source) { modes += it; binding }
            assertEquals(listOf("history"), modes)
        }
    }
    @Test fun signedOutLocalAndDisabledTargetsCannotBeSelected() {
        assertFalse(target.copy(kind = "local", signedIn = false).selectable)
        assertFalse(target.copy(status = "disabled").selectable)
        assertFalse(target.copy(deleting = true).selectable)
        assertTrue(target.copy(kind = "local", signedIn = true).selectable)
    }
}
