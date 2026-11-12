package ai.nuphos.android.data

import org.junit.Assert.*
import org.junit.Test

class RuntimeBlockedConflictTest {
    @Test fun aBlockedRuntimeIsSaidForAPhoneAndOffersSwitch() {
        for (code in listOf("runtime_login_required", "runtime_disabled", "runtime_not_found", "runtime_offline")) {
            // The server's text names the desktop's settings; the phone says its own.
            val conflict = AgentChatApi.conflict(409, """{"error":{"code":"$code","message":"Enable it in Settings → Agent."}}""")
            assertTrue(conflict is AgentChatApi.Conflict.RuntimeBlocked)
            assertFalse(conflict.message!!.contains("Settings"))
            assertTrue(conflict.message in AgentChatApi.switchRuntimeErrors)
        }
    }

    @Test fun onlyASignedOutAgentOffersAnAsk() {
        val conflict = AgentChatApi.conflict(409, """{"error":{"code":"runtime_login_required","message":"Signed out."}}""")
        assertEquals(AgentChatApi.signedOutError, conflict.message)
        val offline = AgentChatApi.conflict(409, """{"error":{"code":"runtime_offline","message":"Offline."}}""")
        assertNotEquals(AgentChatApi.signedOutError, offline.message)
    }

    @Test fun asksWhoeverCanSignTheAgentIn() {
        assertEquals("Ask owner", AgentChatApi.signInAsk("local_u2_dev1", "u1", isAdministrator = true))
        assertNull(AgentChatApi.signInAsk("local_u1_dev1_codex", "u1", isAdministrator = false))
        // An id that only starts like the viewer's is still someone else's computer.
        assertEquals("Ask owner", AgentChatApi.signInAsk("local_u10_dev1", "u1", isAdministrator = false))
        assertEquals("Ask an admin", AgentChatApi.signInAsk("rt_team", "u1", isAdministrator = false))
        assertNull(AgentChatApi.signInAsk("rt_team", "u1", isAdministrator = true))
        assertNull(AgentChatApi.signInAsk(null, "u1", isAdministrator = false))
    }

    @Test fun otherErrorsKeepTheServerText() {
        val conflict = AgentChatApi.conflict(409, """{"error":{"code":"runtime_busy","message":"Busy."}}""")
        assertEquals("Busy.", conflict.message)
        assertFalse(conflict.message in AgentChatApi.switchRuntimeErrors)
    }
}
