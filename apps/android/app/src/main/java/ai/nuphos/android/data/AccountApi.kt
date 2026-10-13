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

    private suspend inline fun <reified T> execute(
        path: String, method: String, body: JsonObject? = null, authenticated: Boolean = true,
    ): T = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("${NuphosApi.BASE_URL}/auth/$path")
            .header("Accept", "application/json")
            .header("x-atlas-client", Http.clientHeader())
            .apply { if (authenticated) header("Authorization", "Bearer $token") }
            .method(method, body?.toString()?.toRequestBody(Http.jsonMedia)).build()
        client.newCall(request).execute().use { response ->
            val text = response.body.string()
            if (response.code == 401) throw NuphosApi.Failure.Unauthorized
            if (!response.isSuccessful) {
                val message = runCatching {
                    Http.json.parseToJsonElement(text).jsonObject["error"]?.jsonObject
                        ?.get("message")?.jsonPrimitive?.contentOrNull
                }.getOrNull()
                throw NuphosApi.Failure.Http(response.code, message)
            }
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
