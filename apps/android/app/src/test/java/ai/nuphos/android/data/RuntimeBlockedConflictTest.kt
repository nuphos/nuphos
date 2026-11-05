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

    @Test fun otherErrorsKeepTheServerText() {
        val conflict = AgentChatApi.conflict(409, """{"error":{"code":"runtime_busy","message":"Busy."}}""")
        assertEquals("Busy.", conflict.message)
        assertFalse(conflict.message in AgentChatApi.switchRuntimeErrors)
    }
}
