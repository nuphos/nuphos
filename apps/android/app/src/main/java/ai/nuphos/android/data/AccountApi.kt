package ai.nuphos.android.data

import ai.nuphos.android.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class AccountApi internal constructor(private val token: String, private val client: OkHttpClient) {
    private val origin = if (token.isEmpty()) BackendOrigin.current else BackendOrigin.forToken(token)

    constructor(token: String) : this(token, Http.client)

    companion object {
        const val AI_CONSENT_VERSION = "2026-09-28"
        private val MFA_CODE_ERRORS = setOf("invalid_mfa_code", "mfa_challenge_expired")
    }

    /** Uses the same existing-account endpoint as iOS; never stores credentials. */
    suspend fun passwordSignIn(email: String, password: String): String {
        require(email.trim().isNotBlank() && email.trim().length <= 254 && password.length in 12..128)
        val result: JsonObject = execute("password/sign-in", "POST", buildJsonObject {
            put("email", email.trim()); put("password", password)
        }, authenticated = false, allowRedirects = false)
        return (result["token"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            ?.takeIf { it.isNotBlank() } ?: throw NuphosApi.Failure.InvalidResponse
    }

    suspend fun requestSignInCode(email: String) {
        require(email.trim().isNotBlank() && email.trim().length <= 254)
        val result: JsonObject = execute("email/request-code", "POST", buildJsonObject {
            put("email", email.trim())
        }, authenticated = false, allowRedirects = false)
        if (result["ok"] != JsonPrimitive(true)) throw NuphosApi.Failure.InvalidResponse
    }

    suspend fun emailSignIn(email: String, code: String): String {
        require(email.trim().isNotBlank() && email.trim().length <= 254)
        require(code.matches(Regex("[0-9]{6}")))
        val result: JsonObject = execute("email/verify-code", "POST", buildJsonObject {
            put("email", email.trim()); put("code", code)
        }, authenticated = false, allowRedirects = false)
        return (result["token"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            ?.takeIf { it.isNotBlank() } ?: throw NuphosApi.Failure.InvalidResponse
    }

    suspend fun consent(): AIConsent = execute("ai-consent", "GET")

    suspend fun setConsent(accepted: Boolean): AIConsent = execute("ai-consent", "PUT", buildJsonObject {
        put("version", AI_CONSENT_VERSION)
        put("accepted", accepted)
    })

    suspend fun updateProfile(name: String, username: String, avatarURL: String): NuphosUser {
        require(profileValidationError(name, username) == null) { "Invalid profile." }
        return execute("me", "PATCH", buildJsonObject {
            put("name", name.trim()); put("username", username.trim()); put("avatarURL", avatarURL)
        })
    }

    /** Uploads a profile photo, or removes it with `null`; the backend re-encodes it to a 256px WebP. */
    suspend fun setAvatar(image: ByteArray?): NuphosUser =
        execute("me/avatar", if (image == null) "DELETE" else "PUT", upload = image)

    suspend fun deletion(): AccountDeletionResponse = execute("account-deletion", "GET")

    suspend fun requestCode(email: String) {
        val result: JsonObject = execute("email/request-code", "POST", buildJsonObject { put("email", email) }, authenticated = false)
        if ((result["ok"] as? JsonPrimitive)?.let { !it.isString && it.booleanOrNull == true } != true) throw NuphosApi.Failure.InvalidResponse
    }

    suspend fun requestDeletion(confirmation: String, password: String? = null, code: String? = null): AccountDeletionResponse {
        require(deletionValidationError(confirmation, password, code) == null) { "Invalid deletion confirmation." }
        return execute("account-deletion", "POST", buildJsonObject {
            put("confirmation", confirmation)
            if (password != null) put("password", password)
            if (code != null) put("code", code)
        })
    }

    /**
     * The account's sign-ins. A sign-in from before sessions gets 403 `session_required`,
     * thrown as [NuphosApi.Failure.Http]; it is not a reason to sign out.
     */
    suspend fun signInSessions(): List<SignInSession> = execute<SignInSessionsEnvelope>("sessions", "GET").sessions

    suspend fun signOutSession(id: String) {
        require(id.matches(Regex("[0-9a-fA-F]{24}"))) { "Invalid session." }
        execute<Unit>("sessions/$id", "DELETE")
    }

    /** Signs out every device but this one; returns how many were signed out. */
    suspend fun signOutOtherSessions(): Int = execute<SignedOutSessions>("sessions", "DELETE").revoked

    // Two-factor authentication (Profile -> Two-factor authentication).

    /** The second step of a sign-in that answered with [NuphosApi.Failure.MfaRequired]. */
    suspend fun verifyMfa(challenge: String, code: String): String {
        val result: JsonObject = execute("mfa/verify", "POST", buildJsonObject {
            put("mfaToken", challenge); put("code", code.trim())
        }, authenticated = false, allowRedirects = false)
        return (result["token"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            ?.takeIf { it.isNotBlank() } ?: throw NuphosApi.Failure.InvalidResponse
    }

    suspend fun mfaStatus(): MfaStatus = execute("mfa", "GET")

    suspend fun startMfaSetup(): MfaSetup = execute("mfa/totp/setup", "POST")

    /** Turns it on; the recovery codes are shown only this once. */
    suspend fun confirmMfaSetup(code: String): List<String> =
        execute<RecoveryCodes>("mfa/totp/confirm", "POST", buildJsonObject { put("code", code.trim()) }).recoveryCodes

    suspend fun newRecoveryCodes(code: String): List<String> =
        execute<RecoveryCodes>("mfa/recovery-codes", "POST", buildJsonObject { put("code", code.trim()) }).recoveryCodes

    // Passkeys: added once it is on, then usable wherever a code is.

    /** To finish a sign-in with a passkey (Passkeys.answer), bound to that sign-in. */
    suspend fun signInPasskeyOptions(challenge: String): JsonObject =
        execute("mfa/verify/options", "POST", buildJsonObject { put("mfaToken", challenge) }, authenticated = false)

    suspend fun verifyMfaPasskey(challenge: String, answer: JsonElement): String {
        val result: JsonObject = execute("mfa/verify", "POST", buildJsonObject {
            put("mfaToken", challenge); put("passkey", answer)
        }, authenticated = false, allowRedirects = false)
        return (result["token"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            ?.takeIf { it.isNotBlank() } ?: throw NuphosApi.Failure.InvalidResponse
    }

    /** For this session: step-up and removing a passkey. */
    suspend fun sessionPasskeyOptions(): JsonObject = execute("mfa/passkey-options", "POST")

    suspend fun reauthMfaPasskey(answer: JsonElement) {
        execute<Unit>("mfa/reauth", "POST", buildJsonObject { put("passkey", answer) })
    }

    suspend fun passkeyRegistrationOptions(): JsonObject = execute("mfa/passkeys/options", "POST")

    suspend fun addPasskey(response: JsonElement, name: String) {
        execute<Unit>("mfa/passkeys", "POST", buildJsonObject { put("response", response); put("name", name) })
    }

    suspend fun removePasskey(id: String, code: String) {
        execute<Unit>("mfa/passkeys/$id", "DELETE", buildJsonObject { put("code", code.trim()) })
    }

    /** Step-up: a current code makes this session recently verified again (StepUp.kt). */
    suspend fun reauthMfa(code: String) {
        execute<Unit>("mfa/reauth", "POST", buildJsonObject { put("code", code.trim()) })
    }

    suspend fun disableMfa(code: String) {
        execute<Unit>("mfa/disable", "POST", buildJsonObject { put("code", code.trim()) })
    }

    /** Ends this device's session on the server. Best effort: failures are ignored. */
    suspend fun endSession() = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder().url("${origin}/auth/sessions/current")
                .header("Authorization", "Bearer $token")
                .header("x-atlas-client", Http.clientHeader())
                .delete().build()
            client.newCall(request).execute().close()
        }
        Unit
    }

    private suspend inline fun <reified T> execute(
        path: String, method: String, body: JsonObject? = null, authenticated: Boolean = true, allowRedirects: Boolean = true,
        upload: ByteArray? = null,
    ): T = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("${origin}/auth/$path")
            .header("Accept", "application/json")
            .header("x-atlas-client", Http.clientHeader())
            .apply { if (authenticated) header("Authorization", "Bearer $token") }
            .method(method, upload?.toRequestBody("application/octet-stream".toMediaType()) ?: body?.toString()?.toRequestBody(Http.jsonMedia)).build()
        val transport = if (allowRedirects) client else client.newBuilder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build()
        transport.newCall(request).execute().use { response ->
            val text = response.body.string()
            val error = if (response.isSuccessful) null
                else runCatching { Http.json.parseToJsonElement(text).jsonObject["error"]?.jsonObject }.getOrNull()
            mfaChallenge(error)?.let { throw NuphosApi.Failure.MfaRequired(it) }
            // A refused two-factor code is a 401 too, but the session is fine.
            val codeRefused = MFA_CODE_ERRORS.contains(runCatching { error?.get("code")?.jsonPrimitive?.contentOrNull }.getOrNull() ?: "")
            if (response.code == 401 && !codeRefused) throw NuphosApi.Failure.Unauthorized
            if (!response.isSuccessful) {
                val message = runCatching { error?.get("message")?.jsonPrimitive?.contentOrNull }.getOrNull()
                val code = runCatching { error?.get("code")?.jsonPrimitive?.contentOrNull }.getOrNull()
                throw NuphosApi.Failure.Http(response.code, message, code)
            }
            if (T::class == Unit::class) return@use Unit as T
            try {
                val objectBody = Http.json.parseToJsonElement(text).jsonObject
                if (T::class == AIConsent::class) {
                    val version = objectBody["version"] as? JsonPrimitive
                    val accepted = objectBody["accepted"] as? JsonPrimitive
                    if (version?.isString != true || accepted == null || accepted.isString || accepted.booleanOrNull == null)
                        throw NuphosApi.Failure.InvalidResponse
                }
                if (T::class == AccountDeletionResponse::class && !objectBody.containsKey("request"))
                    throw NuphosApi.Failure.InvalidResponse
                Http.json.decodeFromString<T>(text)
            }
            catch (_: Exception) { throw NuphosApi.Failure.InvalidResponse }
        }
    }
}

@kotlinx.serialization.Serializable
data class MfaStatus(
    val enabled: Boolean,
    val enabledAt: String? = null,
    val recoveryCodesRemaining: Int = 0,
    /** Empty from a backend without passkeys. */
    val passkeys: List<PasskeyInfo> = emptyList(),
)

@kotlinx.serialization.Serializable
data class PasskeyInfo(val id: String, val name: String, val createdAt: String)

@kotlinx.serialization.Serializable
data class MfaSetup(val secret: String, val otpauthUrl: String)

@kotlinx.serialization.Serializable
private data class RecoveryCodes(val recoveryCodes: List<String>)

/** The challenge in a `401 mfa_required` error, if that is what it is. */
internal fun mfaChallenge(error: JsonObject?): String? = runCatching {
    if (error?.get("code")?.jsonPrimitive?.contentOrNull != "mfa_required") return null
    error["details"]?.jsonObject?.get("mfaToken")?.jsonPrimitive?.contentOrNull
}.getOrNull()
