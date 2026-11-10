package ai.nuphos.android.data

import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.AgentConversationsPage
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.model.ChannelAgentsEnvelope
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
    const val BASE_URL = ai.nuphos.android.BuildConfig.API_BASE_URL

    sealed class Failure : Exception() {
        data object Unauthorized : Failure() {
            private fun readResolve(): Any = Unauthorized
            override val message = "Your session has expired. Please sign in again."
        }

        data class Http(val code: Int, val serverMessage: String?, val errorCode: String? = null) : Failure() {
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
        channels: Boolean = false,
        pendingDecision: Boolean = false,
    ): AgentConversationsPage {
        val query = conversationQuery(teamId, cursor, limit, scope, search, includeArchived, channels, pendingDecision)
        return get("agent/conversations", token, query, timeoutSeconds = 20)
    }

    fun conversationQuery(
        teamId: String,
        cursor: String? = null,
        limit: Int = 30,
        scope: ConversationScope = ConversationScope.Mine,
        search: String? = null,
        includeArchived: Boolean = false,
        channels: Boolean = false,
        pendingDecision: Boolean = false,
    ): List<Pair<String, String>> {
        return buildList {
            add("teamId" to teamId)
            add("limit" to limit.toString())
            // Same fixed order as iOS: most recent activity first.
            add("sort" to "activity")
            add("scope" to scope.raw)
            if (cursor != null) add("cursor" to cursor)
            if (!search.isNullOrEmpty()) add("search" to search)
            if (!includeArchived) add("archived" to "exclude")
            // Chats are their own listing: the server never mixes them with agents.
            if (channels) add("kind" to "channel")
            // Only conversations with an open question, each with every parent above it.
            if (pendingDecision) add("pendingDecision" to "true")
        }
    }

    /** The agents brought into a chat. */
    suspend fun channelAgents(token: String, teamId: String, channelId: String, transport: OkHttpClient = Http.client): List<ChannelAgent> =
        get<ChannelAgentsEnvelope>("agent/conversations/${requireSession(channelId)}/agents", token,
            listOf("teamId" to teamId), timeoutSeconds = 20, forbiddenIsUnauthorized = false, transport = transport).agents

    /** A file group posted in a chat, readable by anyone who can read the chat. */
    suspend fun channelAttachment(token: String, teamId: String, channelId: String, groupId: String,
                                  transport: OkHttpClient = Http.client): TransferDownloadGroup {
        require(groupId.matches(Regex("[A-Za-z0-9_-]{1,64}")))
        return get("agent/conversations/${requireSession(channelId)}/attachments/$groupId", token,
            listOf("teamId" to teamId), timeoutSeconds = 20, forbiddenIsUnauthorized = false, transport = transport)
    }

    private fun requireSession(id: String): String {
        require(id.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        return id
    }

    suspend fun conversationDetail(
        token: String,
        teamId: String,
        sessionId: String,
        tail: Int = 100,
    ): AgentConversationDetail = conversationDetail(Http.client, token, teamId, sessionId, tail)

    internal suspend fun conversationDetail(
        client: OkHttpClient,
        token: String,
        teamId: String,
        sessionId: String,
        tail: Int = 100,
    ): AgentConversationDetail = get(
        "agent/conversations/$sessionId",
        token,
        listOf("teamId" to teamId, "tail" to tail.toString()),
        timeoutSeconds = 20,
        forbiddenIsUnauthorized = false,
        transport = client,
    )

    /** Same endpoint and team scope as iOS; a denial must not sign out the chat. */
    suspend fun sessionResources(token: String, teamId: String, sessionId: String): List<ai.nuphos.android.model.SessionResource> =
        get<ai.nuphos.android.model.SessionResourcesEnvelope>(
            "agent/conversations/$sessionId/resources", token, listOf("teamId" to teamId),
            timeoutSeconds = 12, forbiddenIsUnauthorized = false,
        ).resources

    suspend fun credentialOptions(token: String, teamId: String, forNewConversation: Boolean = false): CredentialCatalog {
        val json: JsonValue = get("agent/credential-options", token, listOf("teamId" to teamId), timeoutSeconds = 20)
        return CredentialCatalog(json["options"] ?: json, if (forNewConversation) CredentialCatalog.NEW_CONVERSATION_PROVIDERS else CredentialCatalog.PROVIDERS)
    }

    @Serializable
    private data class ShareApprovalEnvelope(val status: String? = null)

    /** Whether the caller's conversation on a teammate's shared computer waits for its owner; null when never asked. */
    suspend fun ownShareApproval(token: String, sessionId: String): String? =
        get<ShareApprovalEnvelope>("agent/devices/share-approvals/mine", token, listOf("sessionId" to sessionId), timeoutSeconds = 15).status

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
        forbiddenIsUnauthorized: Boolean = true,
        transport: OkHttpClient = Http.client,
    ): T = withContext(Dispatchers.IO) {
        val url = BASE_URL.toHttpUrl().newBuilder().addPathSegments(path).apply {
            query.forEach { (k, v) -> addQueryParameter(k, v) }
        }.build()
        val client = transport.newBuilder()
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
                response.code == 401 || (response.code == 403 && forbiddenIsUnauthorized) -> throw Failure.Unauthorized
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
