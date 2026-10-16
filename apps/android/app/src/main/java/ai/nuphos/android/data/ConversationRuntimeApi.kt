package ai.nuphos.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/** Uses the same workspace-to-history fallback as iOS; other failures never retry a move. */
object ConversationRuntimeApi {
    private val client by lazy { Http.client.newBuilder().readTimeout(120, TimeUnit.SECONDS).callTimeout(120, TimeUnit.SECONDS).build() }
    suspend fun move(token: String, team: String, session: String, target: AgentRuntime, sourceProvider: String?): RuntimeBinding =
        moveWithFallback(target, sourceProvider) { mode -> request(token, team, session, target.id, mode) }

    internal suspend fun moveWithFallback(target: AgentRuntime, sourceProvider: String?, request: suspend (String) -> RuntimeBinding): RuntimeBinding {
        if (target.kind == "local" || target.provider != sourceProvider) return request("history")
        return try { request("workspace") } catch (e: AgentChatApi.Conflict.Other) {
            if (e.status != 409 || e.code != "workspace_unavailable") throw e
            request("history")
        }
    }

    private suspend fun request(token: String, team: String, session: String, target: String, mode: String): RuntimeBinding = withContext(Dispatchers.IO) {
        val url = NuphosApi.BASE_URL.toHttpUrl().newBuilder().addPathSegment("agent").addPathSegment("conversations")
            .addPathSegment(session).addPathSegment("runtime").addQueryParameter("teamId", team).build()
        val body = JsonValue.obj("runtimeId" to JsonValue.Str(target), "mode" to JsonValue.Str(mode))
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
            if (id != target) throw NuphosApi.Failure.InvalidResponse
            RuntimeBinding(id, provider, value["runtimeLabel"]?.stringValue)
        }
    }
}
