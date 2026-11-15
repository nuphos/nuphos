package ai.nuphos.android.model

import ai.nuphos.android.R
import kotlinx.serialization.Serializable

@Serializable
data class AIConsent(val version: String, val accepted: Boolean)

@Serializable
data class AccountDeletionRequest(val status: String, val requestedAt: String, val dueAt: String)

@Serializable
data class AccountDeletionResponse(val request: AccountDeletionRequest?)

fun profileValidationError(name: String, username: String): String? {
    if (name.trim().length !in 1..100) return Words(R.string.storetext_account_name_length)
    if (username.trim().length !in 1..40 || !Regex("^[a-zA-Z0-9_-]+$").matches(username.trim()))
        return Words(R.string.storetext_account_username_rule)
    return null
}

fun deletionValidationError(confirmation: String, password: String? = null, code: String? = null): String? = when {
    confirmation != "DELETE" -> Words(R.string.storetext_account_delete_confirm)
    (password == null) == (code == null) -> Words(R.string.storetext_account_delete_password_or_code)
    password != null && password.length < 12 -> Words(R.string.storetext_account_delete_password_length)
    code != null && code.length != 6 -> Words(R.string.storetext_account_delete_code_length)
    else -> null
}

/** One of the account's sign-ins, as GET /auth/sessions lists it. Every field but `id` may be null. */
@Serializable
data class SignInSession(
    val id: String,
    val current: Boolean? = null,
    val createdAt: String? = null,
    val lastUsedAt: String? = null,
    val expiresAt: String? = null,
    val ip: String? = null,
    val city: String? = null,
    val country: String? = null,
    /** The app's own name and version, e.g. `nuphos-android/1.4.0`. */
    val client: String? = null,
    val userAgent: String? = null,
)

@Serializable
data class SignInSessionsEnvelope(val sessions: List<SignInSession>)

@Serializable
data class SignedOutSessions(val revoked: Int)
