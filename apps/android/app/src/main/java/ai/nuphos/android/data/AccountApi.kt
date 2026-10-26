package ai.nuphos.android.data

import ai.nuphos.android.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class AccountApi internal constructor(private val token: String, private val client: OkHttpClient) {
    constructor(token: String) : this(token, Http.client)

    companion object {
        const val AI_CONSENT_VERSION = "2026-09-28"
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

    suspend fun emailSignIn(email: String, code: String, newPassword: String? = null): String {
        require(email.trim().isNotBlank() && email.trim().length <= 254)
        require(code.matches(Regex("[0-9]{6}")))
        require(newPassword == null || newPassword.length in 12..128)
        val result: JsonObject = execute(if (newPassword == null) "email/verify-code" else "password/set", "POST", buildJsonObject {
            put("email", email.trim()); put("code", code)
            if (newPassword != null) put("password", newPassword)
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
        require(profileValidationError(name, username, avatarURL) == null) { "Invalid profile." }
        return execute("me", "PATCH", buildJsonObject {
            put("name", name.trim()); put("username", username.trim()); put("avatarURL", avatarURL)
        })
    }

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

    /** Ends this device's session on the server. Best effort: failures are ignored. */
    suspend fun endSession() = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder().url("${NuphosApi.BASE_URL}/auth/sessions/current")
                .header("Authorization", "Bearer $token")
                .header("x-atlas-client", Http.clientHeader())
                .delete().build()
            client.newCall(request).execute().close()
        }
        Unit
    }

    private suspend inline fun <reified T> execute(
        path: String, method: String, body: JsonObject? = null, authenticated: Boolean = true, allowRedirects: Boolean = true,
    ): T = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("${NuphosApi.BASE_URL}/auth/$path")
            .header("Accept", "application/json")
            .header("x-atlas-client", Http.clientHeader())
            .apply { if (authenticated) header("Authorization", "Bearer $token") }
            .method(method, body?.toString()?.toRequestBody(Http.jsonMedia)).build()
        val transport = if (allowRedirects) client else client.newBuilder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build()
        transport.newCall(request).execute().use { response ->
            val text = response.body.string()
            if (response.code == 401) throw NuphosApi.Failure.Unauthorized
            if (!response.isSuccessful) {
                val error = runCatching { Http.json.parseToJsonElement(text).jsonObject["error"]?.jsonObject }.getOrNull()
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
