package ai.nuphos.android.data

import ai.nuphos.android.model.validTriggerId
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.AgentConversationsPage
import ai.nuphos.android.model.ConversationScope
import ai.nuphos.android.model.CredentialCatalog
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.model.Team
import ai.nuphos.android.model.TeamMember
import ai.nuphos.android.model.TeamMembersEnvelope
import ai.nuphos.android.model.TeamsEnvelope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

object NuphosApi {
    const val BASE_URL = "https://api.nuphos.ai"

    sealed class Failure : Exception() {
        data object Unauthorized : Failure() {
            private fun readResolve(): Any = Unauthorized
            override val message = "Your session has expired. Please sign in again."
        }

        data class Http(val code: Int, val serverMessage: String?) : Failure() {
            override val message = serverMessage ?: "Nuphos returned an unexpected response ($code)."
        }

        data object InvalidResponse : Failure() {
            private fun readResolve(): Any = InvalidResponse
            override val message = "Nuphos returned something we could not read."
        }
    }

    suspend fun currentUser(token: String): NuphosUser =
        get("auth/me", token, timeoutSeconds = 10)

    suspend fun teams(token: String): List<Team> =
        get<TeamsEnvelope>("teams", token, timeoutSeconds = 60).teams

    suspend fun teamMembers(token: String, teamId: String, includeRemoved: Boolean = true): List<TeamMember> {
        val query = if (includeRemoved) listOf("includeRemoved" to "true") else emptyList()
        return get<TeamMembersEnvelope>("teams/$teamId/members", token, query, timeoutSeconds = 20).members
    }

    suspend fun conversations(
        token: String,
        teamId: String,
        cursor: String? = null,
        limit: Int = 30,
        scope: ConversationScope = ConversationScope.Mine,
        search: String? = null,
        includeArchived: Boolean = false,
        archivedOnly: Boolean = false,
        triggerId: String? = null,
    ): AgentConversationsPage {
        val query = conversationQuery(teamId, cursor, limit, scope, search, includeArchived, archivedOnly, triggerId)
        return get("agent/conversations", token, query, timeoutSeconds = 20)
    }

    fun conversationQuery(
        teamId: String,
        cursor: String? = null,
        limit: Int = 30,
        scope: ConversationScope = ConversationScope.Mine,
        search: String? = null,
        includeArchived: Boolean = false,
        archivedOnly: Boolean = false,
        triggerId: String? = null,
    ): List<Pair<String, String>> {
        if (triggerId != null) {
            require(teamId.isNotBlank() && validTriggerId(triggerId)) { "Select a valid trigger and team." }
        }
        return buildList {
            add("teamId" to teamId)
            add("limit" to limit.toString())
            add("scope" to if (triggerId != null) ConversationScope.Team.raw else scope.raw)
            if (triggerId != null) add("triggerId" to triggerId)
            if (cursor != null) add("cursor" to cursor)
            if (!search.isNullOrEmpty()) add("search" to search)
            if (archivedOnly) add("archived" to "only")
            else if (!includeArchived) add("archived" to "exclude")
        }
    }

    suspend fun conversationDetail(
        token: String,
        teamId: String,
        sessionId: String,
        tail: Int = 100,
    ): AgentConversationDetail = get(
        "agent/conversations/$sessionId",
        token,
        listOf("teamId" to teamId, "tail" to tail.toString()),
        timeoutSeconds = 20,
    )

    suspend fun credentialOptions(token: String, teamId: String): CredentialCatalog {
        val json: JsonValue = get("agent/credential-options", token, listOf("teamId" to teamId), timeoutSeconds = 20)
        return CredentialCatalog(json["options"] ?: json)
    }

    @Serializable
    private data class ErrorEnvelope(val error: Inner? = null) {
        @Serializable
        data class Inner(val message: String? = null)
    }

    private suspend inline fun <reified T> get(
        path: String,
        token: String,
        query: List<Pair<String, String>> = emptyList(),
        timeoutSeconds: Long,
    ): T = withContext(Dispatchers.IO) {
        val url = BASE_URL.toHttpUrl().newBuilder().addPathSegments(path).apply {
            query.forEach { (k, v) -> addQueryParameter(k, v) }
        }.build()
        val client = Http.client.newBuilder()
            .callTimeout(timeoutSeconds, TimeUnit.SECONDS)
            .readTimeout(timeoutSeconds, TimeUnit.SECONDS)
            .build()
        val request = Request.Builder()
            .url(url)
            .get()
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")
            .header("x-atlas-client", Http.clientHeader())
            .build()
        client.newCall(request).execute().use { response ->
            val body = response.body.string()
            when {
                response.isSuccessful -> runCatching {
                    Http.json.decodeFromString<T>(body)
                }.getOrElse { throw Failure.InvalidResponse }
                response.code == 401 || response.code == 403 -> throw Failure.Unauthorized
                else -> {
                    val message = runCatching {
                        Http.json.decodeFromString<ErrorEnvelope>(body).error?.message
                    }.getOrNull()
                    throw Failure.Http(response.code, message)
                }
            }
        }
    }
}
