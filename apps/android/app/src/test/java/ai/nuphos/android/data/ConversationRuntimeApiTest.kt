package ai.nuphos.android.data

import org.junit.Assert.*
import org.junit.Test

class ConversationRuntimeApiTest {
    private val target = AgentRuntime("new", "codex", "New", "active", "managed")
    @Test fun signedOutLocalAndDisabledTargetsCannotBeSelected() {
        assertFalse(target.copy(kind = "local", signedIn = false).selectable)
        assertFalse(target.copy(status = "disabled").selectable)
        assertFalse(target.copy(deleting = true).selectable)
        assertTrue(target.copy(kind = "local", signedIn = true).selectable)
    }
}
