package ai.nuphos.android.session

import ai.nuphos.android.data.AccountApi
import org.junit.Assert.*
import org.junit.Test

class LaunchConsentTest {
    private class Memory : LaunchConsent.Store {
        var value: String? = null
        override fun read() = value
        override fun write(value: String?) { this.value = value }
    }

    private val memory = Memory()
    private val consent = LaunchConsent(memory)

    @Test fun opensOnlyForTheTokenAndUserThatAccepted() {
        consent.remember("token-a", "user-a", AccountApi.AI_CONSENT_VERSION)
        assertTrue(consent.accepted("token-a", "user-a"))
        assertFalse("another login", consent.accepted("token-b", "user-a"))
        assertFalse("another user", consent.accepted("token-a", "user-b"))
    }

    @Test fun neverStoresTheToken() {
        consent.remember("synthetic-secret-token", "user-a", AccountApi.AI_CONSENT_VERSION)
        assertFalse(memory.value!!.contains("synthetic-secret-token"))
    }

    @Test fun anotherNoticeVersionIsNotKept() {
        consent.remember("token-a", "user-a", AccountApi.AI_CONSENT_VERSION)
        consent.remember("token-a", "user-a", "2099-01-01")
        assertNull(memory.value)
        assertFalse(consent.accepted("token-a", "user-a"))
    }

    @Test fun aRecordFromAnotherBuildsNoticeDoesNotOpen() {
        consent.remember("token-a", "user-a", AccountApi.AI_CONSENT_VERSION)
        memory.value = memory.value!!.replace(AccountApi.AI_CONSENT_VERSION, "2020-01-01")
        assertFalse(consent.accepted("token-a", "user-a"))
    }

    @Test fun clearForgetsIt() {
        consent.remember("token-a", "user-a", AccountApi.AI_CONSENT_VERSION)
        consent.clear()
        assertFalse(consent.accepted("token-a", "user-a"))
    }
}
