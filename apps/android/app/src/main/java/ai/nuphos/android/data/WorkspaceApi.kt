package ai.nuphos.android.data

import ai.nuphos.android.model.Team
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class WorkspaceAlreadyMember : Exception("You are already a member of this workspace.")

interface WorkspaceTransport {
    suspend fun memberships(): List<Team>
    suspend fun discoverable(): List<Team>
    suspend fun create(name: String): Team
    suspend fun join(teamId: String): Team
}

/** Workspace reads and writes use the account token, without granting AI or member roles. */
class WorkspaceApi internal constructor(private val token: String, private val client: OkHttpClient) : WorkspaceTransport {
    constructor(token: String) : this(token, Http.client)
    override suspend fun memberships() = teams("teams")
    override suspend fun discoverable() = teams("teams/discoverable").also {
        if (it.size > 50) throw NuphosApi.Failure.InvalidResponse
    }
    override suspend fun create(name: String): Team {
        val trimmed = name.trim()
        require(trimmed.length in 1..80) { "Use a workspace name with 1–80 characters." }
        return team(execute("teams", "POST", buildJsonObject { put("name", trimmed) }.toString(), 201))
    }
    override suspend fun join(teamId: String): Team {
        require(teamId.matches(Regex("[a-fA-F0-9]{24}"))) { "Invalid workspace ID." }
        return team(execute("teams/discoverable/$teamId/join", "POST", "", 201))
    }
    private suspend fun teams(path: String): List<Team> {
        val body = execute(path, "GET", expected = 200)
        val array = body["teams"] as? JsonArray ?: throw NuphosApi.Failure.InvalidResponse
        return array.map { decodeTeam(it) }
    }
    private fun team(body: JsonObject) = decodeTeam(body["team"] ?: throw NuphosApi.Failure.InvalidResponse)
    private fun decodeTeam(value: JsonElement): Team = try {
        Http.json.decodeFromJsonElement<Team>(value).also {
            if (!it.id.matches(Regex("[a-fA-F0-9]{24}"))) throw NuphosApi.Failure.InvalidResponse
        }
    } catch (_: Exception) { throw NuphosApi.Failure.InvalidResponse }
    private suspend fun execute(path: String, method: String, body: String? = null, expected: Int): JsonObject = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("${NuphosApi.BASE_URL}/$path")
            .header("Authorization", "Bearer $token").header("Accept", "application/json")
            .header("x-atlas-client", Http.clientHeader())
            .method(method, body?.toRequestBody(Http.jsonMedia)).build()
        client.newCall(request).execute().use { response ->
            val text = response.body.string()
            if (response.code == 401) throw NuphosApi.Failure.Unauthorized
            if (!response.isSuccessful) {
                val errorCode = runCatching {
                    Http.json.parseToJsonElement(text).jsonObject["error"]?.jsonObject?.get("code")?.jsonPrimitive?.contentOrNull
                }.getOrNull()
                if (response.code == 409 && errorCode == "already_member") throw WorkspaceAlreadyMember()
                val message = runCatching {
                    Http.json.parseToJsonElement(text).jsonObject["error"]?.jsonObject?.get("message")?.jsonPrimitive?.contentOrNull
                }.getOrNull()
                throw NuphosApi.Failure.Http(response.code, message)
            }
            if (response.code != expected) throw NuphosApi.Failure.InvalidResponse
            try { Http.json.parseToJsonElement(text).jsonObject }
            catch (_: Exception) { throw NuphosApi.Failure.InvalidResponse }
        }
    }
}
