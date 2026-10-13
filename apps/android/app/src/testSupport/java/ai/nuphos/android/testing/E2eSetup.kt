package ai.nuphos.android.testing

import kotlinx.serialization.Serializable

@Serializable
data class E2eConfig(
    val expectedEmail: String,
    val teamId: String,
    val mode: String,
    val allowLogin: Boolean = false,
    val password: String? = null,
) {
    fun validate() {
        check(expectedEmail.isNotBlank() && '@' in expectedEmail && teamId.matches(Regex("[A-Za-z0-9_-]+"))) { "Configure expected account and team." }
        check(mode == "existing-session" || mode == "password") { "Invalid login mode." }
        if (mode == "password") check(allowLogin && password != null && password.length in 12..128) { "Dedicated login was not configured." }
        else check(!allowLogin && password == null) { "Existing-session mode cannot accept credentials." }
    }
    override fun toString() = "E2eConfig(values withheld)"
}

data class E2eIdentity(val email: String, val teams: Set<String>, val consent: Boolean)

interface E2eGateway {
    fun login(email: String, password: String): String
    fun identity(token: String): E2eIdentity
}

object E2eSetup {
    fun prepare(config: E2eConfig, savedToken: String?, gateway: E2eGateway, save: (String) -> Unit): String {
        config.validate()
        val token = if (config.mode == "existing-session") {
            check(!savedToken.isNullOrBlank()) { "Sign in on the device first." }
            savedToken
        } else {
            check(savedToken == null) { "Dedicated login requires an empty token store." }
            gateway.login(config.expectedEmail, requireNotNull(config.password))
        }
        check(token.isNotBlank()) { "Sign-in did not return a session." }
        val identity = gateway.identity(token)
        check(identity.email == config.expectedEmail) { "Signed-in account does not match configuration." }
        check(config.teamId in identity.teams) { "Configured team is not accessible." }
        check(identity.consent) { "Confirm current AI consent before live tests." }
        if (config.mode == "password") save(token)
        return token
    }
}
