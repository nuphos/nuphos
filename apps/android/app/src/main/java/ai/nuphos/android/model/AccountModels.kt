package ai.nuphos.android.model

import kotlinx.serialization.Serializable
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

@Serializable
data class AIConsent(val version: String, val accepted: Boolean)

@Serializable
data class AccountDeletionRequest(val status: String, val requestedAt: String, val dueAt: String)

@Serializable
data class AccountDeletionResponse(val request: AccountDeletionRequest?)

fun profileValidationError(name: String, username: String, avatarURL: String): String? {
    if (name.trim().length !in 1..100) return "Enter a name of 1–100 characters."
    if (username.trim().length !in 1..40 || !Regex("^[a-zA-Z0-9_-]+$").matches(username.trim()))
        return "Use 1–40 letters, numbers, underscores or hyphens for your username."
    if (avatarURL.isEmpty()) return null
    val url = avatarURL.toHttpUrlOrNull()
    if (avatarURL.length > 2048 || url == null || url.scheme != "https" ||
        url.port != 443 || url.username.isNotEmpty() || url.password.isNotEmpty() ||
        !Regex("^lh[3-6]\\.googleusercontent\\.com$").matches(url.host))
        return "Use a Google profile-image URL (lh3–lh6.googleusercontent.com), or leave it empty."
    return null
}

fun deletionValidationError(confirmation: String, password: String? = null, code: String? = null): String? = when {
    confirmation != "DELETE" -> "Enter DELETE to confirm."
    (password == null) == (code == null) -> "Use either your password or an email code."
    password != null && password.length < 12 -> "Enter a password of at least 12 characters."
    code != null && code.length != 6 -> "Enter the six-character email code."
    else -> null
}
