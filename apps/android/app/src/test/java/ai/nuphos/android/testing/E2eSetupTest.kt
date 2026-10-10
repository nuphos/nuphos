package ai.nuphos.android.testing

import org.junit.Assert.*
import org.junit.Test

class E2eSetupTest {
    private val config = E2eConfig("tester@example.invalid", "team-fixture", "existing-session")
    private class Gateway : E2eGateway {
        var email = "tester@example.invalid"
        var teams = setOf("team-fixture")
        var consent = true
        var calls = 0
        override fun login(email: String, password: String): String { calls++; return "fixture-token" }
        override fun identity(token: String) = E2eIdentity(email, teams, consent)
    }
    private fun rejected(block: () -> Unit) {
        try { block(); fail("Expected setup rejection") } catch (_: IllegalStateException) { }
    }
    @Test fun existingSessionNeverWritesOrLogsIn() {
        val gateway = Gateway()
        assertEquals("installed-token", E2eSetup.prepare(config, "installed-token", gateway) { fail("Token write") })
        assertEquals(0, gateway.calls)
    }
    @Test fun wrongIdentityTeamAndConsentMakeZeroWrites() {
        for (change in listOf<(Gateway) -> Unit>({ it.email = "other@example.invalid" }, { it.teams = emptySet() }, { it.consent = false })) {
            val gateway = Gateway().also(change)
            rejected { E2eSetup.prepare(config, "installed-token", gateway) { fail("Token write") } }
        }
    }
    @Test fun missingSessionAndConfigurationFailClosed() {
        rejected { E2eSetup.prepare(config, null, Gateway()) { fail("Token write") } }
        for (bad in listOf(config.copy(expectedEmail = ""), config.copy(teamId = ""), config.copy(mode = "unknown"),
            config.copy(password = "private-password"), config.copy(allowLogin = true))) {
            rejected { E2eSetup.prepare(bad, "installed-token", Gateway()) { fail("Token write") } }
        }
    }
    @Test fun dedicatedLoginRejectsExistingTokenBeforeNetwork() {
        val gateway = Gateway()
        val password = config.copy(mode = "password", password = "fixture-password", allowLogin = true)
        rejected { E2eSetup.prepare(password, "installed-token", gateway) { fail("Token write") } }
        assertEquals(0, gateway.calls)
        rejected { E2eSetup.prepare(password.copy(allowLogin = false), null, gateway) { fail("Token write") } }
    }
    @Test fun dedicatedLoginSavesOnceAfterValidation() {
        val gateway = Gateway()
        val writes = mutableListOf<String>()
        val password = config.copy(mode = "password", password = "fixture-password", allowLogin = true)
        assertEquals("fixture-token", E2eSetup.prepare(password, null, gateway, writes::add))
        assertEquals(listOf("fixture-token"), writes)
        assertEquals(1, gateway.calls)
        gateway.email = "wrong@example.invalid"
        rejected { E2eSetup.prepare(password, null, gateway) { fail("Token write") } }
        assertFalse(password.toString().contains("fixture-password"))
    }
}
