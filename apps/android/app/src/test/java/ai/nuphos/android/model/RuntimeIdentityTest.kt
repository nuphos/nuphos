package ai.nuphos.android.model

import org.junit.Assert.*
import org.junit.Test

class RuntimeIdentityTest {
    @Test fun unknownNeverImpersonatesAProvider() {
        listOf(null, "", "future-provider").forEach { assertNull(RuntimeIdentity.logo(it)) }
        assertEquals("Unknown runtime", RuntimeIdentity.name("future-provider"))
        assertEquals("Runtime", RuntimeIdentity.name(null))
    }
    @Test fun namesRemainIndependentOfInstanceAndHost() {
        assertEquals("Codex", RuntimeIdentity.detail("codex", "Codex"))
        assertEquals("Codex · Studio laptop", RuntimeIdentity.detail("codex", "Studio laptop"))
        assertEquals("OpenCode · Claude", RuntimeIdentity.detail("opencode", "Claude"))
        assertEquals(listOf("openai", "claude", "grok", "opencode", "antigravity"),
            listOf("codex", "claude-code", "grok", "opencode", "antigravity").map(RuntimeIdentity::logo))
        assertTrue(RuntimeIdentity.originalColor("claude-code"))
        assertFalse(RuntimeIdentity.originalColor("antigravity"))
        assertFalse(RuntimeIdentity.originalColor("codex"))
    }
}
