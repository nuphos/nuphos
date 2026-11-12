package ai.nuphos.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/** Moves a conversation to another agent. Only its history moves; failures never retry. */
object ConversationRuntimeApi {
    private val client by lazy { Http.client.newBuilder().readTimeout(120, TimeUnit.SECONDS).callTimeout(120, TimeUnit.SECONDS).build() }
    suspend fun move(token: String, team: String, session: String, target: AgentRuntime): RuntimeBinding = withContext(Dispatchers.IO) {
        val url = NuphosApi.baseUrl(token).toHttpUrl().newBuilder().addPathSegment("agent").addPathSegment("conversations")
            .addPathSegment(session).addPathSegment("runtime").addQueryParameter("teamId", team).build()
        // Older backends require `mode`.
        val body = JsonValue.obj("runtimeId" to JsonValue.Str(target.id), "mode" to JsonValue.Str("history"))
        val request = Request.Builder().url(url).header("Authorization", "Bearer $token")
            .header("Accept", "application/json").header("x-atlas-client", Http.clientHeader())
            .post(Http.json.encodeToString(JsonValue.serializer(), body).toRequestBody(Http.jsonMedia)).build()
        client.newCall(request).execute().use { response ->
            val text = response.body.string()
            if (response.code == 401) throw NuphosApi.Failure.Unauthorized
            if (!response.isSuccessful) throw AgentChatApi.conflict(response.code, text)
            val value = JsonValue.parse(text) ?: throw NuphosApi.Failure.InvalidResponse
            val id = value["runtimeId"]?.stringValue ?: throw NuphosApi.Failure.InvalidResponse
            val provider = value["agentRuntime"]?.stringValue ?: throw NuphosApi.Failure.InvalidResponse
            if (id != target.id) throw NuphosApi.Failure.InvalidResponse
            RuntimeBinding(id, provider, value["runtimeLabel"]?.stringValue)
        }
    }
}
