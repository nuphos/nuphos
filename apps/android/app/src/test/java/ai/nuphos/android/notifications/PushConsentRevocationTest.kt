package ai.nuphos.android.notifications

import ai.nuphos.android.session.AiAccess
import org.junit.Assert.assertEquals
import org.junit.Test

class PushConsentRevocationTest {
    @Test fun revocationNotifiesSynchronouslyAndIgnoresStaleRequests() {
        AiAccess.activate("current")
        AiAccess.grant("current")
        var revoked = 0
        AiAccess.onRevoked = { revoked++ }
        try {
            AiAccess.revokeIfCurrent("old", AiAccess.revision)
            assertEquals(0, revoked)
            AiAccess.revokeIfCurrent("current", AiAccess.revision)
            assertEquals(1, revoked)
            AiAccess.revoke()
            assertEquals(1, revoked)
        } finally {
            AiAccess.onRevoked = {}
            AiAccess.revoke()
        }
    }
}
