package ai.nuphos.android.data

import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.Plan
import ai.nuphos.android.model.PlanApprovalRequirement
import ai.nuphos.android.model.PlanListPage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.Locale

object AgentChatApi {
    data class ChatRequest(
        val id: String,
        val teamId: String,
        val messages: List<ChatMessage>,
        val baseIndex: Int? = null,
        val streamId: String,
        val resume: Boolean? = null,
        val resumeFrom: Int? = null,
        val continueAfterInterruption: Boolean? = null,
        val resumeReason: String? = null,
        val permissionMode: String? = null,
        val credentialAccess: JsonValue? = null,
        val clientCapabilities: Map<String, Boolean>? = null,
        val runtimeId: String? = null,
        val agentRuntime: String? = null,
    )

    fun chatRequest(token: String, body: ChatRequest): Request {
        val json = Http.json.encodeToString(ChatRequestBody.serializer(), ChatRequestBody.from(body))
        return Request.Builder()
            .url("${NuphosApi.BASE_URL}/agent/chat")
            .post(json.toRequestBody(Http.jsonMedia))
            .header("Authorization", "Bearer $token")
            .header("Accept", "text/event-stream")
            .header("Accept-Encoding", "identity")
            .header("x-atlas-client", Http.clientHeader())
            .header("x-atlas-locale", Locale.getDefault().toLanguageTag())
            .header("x-atlas-url", "/teams/${body.teamId}/agent/${body.id}")
            .build()
    }

    @Serializable
    private data class ChatRequestBody(
        val id: String,
        val teamId: String,
        val messages: List<ChatMessage>,
        val baseIndex: Int? = null,
        val streamId: String,
        val resume: Boolean? = null,
        val resumeFrom: Int? = null,
        val continueAfterInterruption: Boolean? = null,
        val resumeReason: String? = null,
        val permissionMode: String? = null,
        val credentialAccess: JsonValue? = null,
        val clientCapabilities: Map<String, Boolean>? = null,
        val runtimeId: String? = null,
        val agentRuntime: String? = null,
    ) {
        companion object {
            fun from(body: ChatRequest) = ChatRequestBody(
                id = body.id,
                teamId = body.teamId,
                messages = body.messages,
                baseIndex = body.baseIndex,
                streamId = body.streamId,
                resume = body.resume,
                resumeFrom = body.resumeFrom,
                continueAfterInterruption = body.continueAfterInterruption,
                resumeReason = body.resumeReason,
                permissionMode = body.permissionMode,
                credentialAccess = body.credentialAccess,
                clientCapabilities = body.clientCapabilities,
                runtimeId = body.runtimeId,
                agentRuntime = body.agentRuntime,
            )
        }
    }

    suspend fun abort(token: String, streamId: String) {
        runCatching {
            send("POST", "agent/chat/$streamId/abort", token)
        }
    }

    suspend fun putTranscript(
        token: String,
        teamId: String,
        sessionId: String,
        title: String,
        messages: List<ChatMessage>,
        baseIndex: Int?,
    ): String? {
        val payload = JsonValue.Obj(
            buildMap {
                put("title", JsonValue.Str(title))
                put("messages", JsonValue.Arr(messages.map { Http.json.decodeFromString(JsonValue.serializer(), Http.json.encodeToString(ChatMessage.serializer(), it)) }))
                put("teamId", JsonValue.Str(teamId))
                if ((baseIndex ?: 0) > 0) put("baseIndex", JsonValue.Number(baseIndex!!.toDouble()))
            },
        )
        val result = JsonValue.parse(send("PUT", "agent/conversations/$sessionId/transcript", token, listOf("teamId" to teamId), payload))
        return result?.get("skipped")?.stringValue
    }

    suspend fun feedback(token: String, teamId: String, sessionId: String, messageId: String, rating: String?, comment: String? = null) {
        val payload = JsonValue.Obj(
            buildMap {
                rating?.let { put("rating", JsonValue.Str(it)) } ?: put("rating", JsonValue.Null)
                comment?.let { put("comment", JsonValue.Str(it)) } ?: put("comment", JsonValue.Null)
                put("teamId", JsonValue.Str(teamId))
            },
        )
        send("POST", "agent/conversations/$sessionId/messages/$messageId/feedback", token, listOf("teamId" to teamId), payload)
    }

    suspend fun approveForSession(token: String, sessionId: String, command: String) {
        send("POST", "agent/auto-mode/session-approvals", token, body = JsonValue.obj(
            "sessionId" to JsonValue.Str(sessionId),
            "command" to JsonValue.Str(command),
        ))
    }

    suspend fun createPolicyRule(token: String, description: String) {
        send("POST", "agent/auto-mode/policy/rules", token, body = JsonValue.obj(
            "description" to JsonValue.Str(description.take(200)),
        ))
    }

    suspend fun activatePolicyRule(token: String, ruleId: String) {
        send("POST", "agent/auto-mode/policy/rules/$ruleId/activate", token)
    }

    suspend fun deletePolicyRule(token: String, ruleId: String) {
        send("DELETE", "agent/auto-mode/policy/rules/$ruleId", token)
    }

    suspend fun bypass(token: String, sessionId: String): Boolean {
        val data = send("GET", "agent/auto-mode/bypass", token, listOf("sessionId" to sessionId))
        val json = JsonValue.parse(data) ?: return false
        return json["bypass"]?.boolValue ?: false
    }

    suspend fun setBypass(token: String, sessionId: String, bypass: Boolean) {
        send(
            "PUT",
            "agent/auto-mode/bypass",
            token,
            body = JsonValue.obj("sessionId" to JsonValue.Str(sessionId), "bypass" to JsonValue.Bool(bypass)),
        )
    }

    suspend fun plan(token: String, teamId: String, planId: String): Plan {
        val data = send("GET", "agent/plans/$planId", token, listOf("teamId" to teamId))
        return decodePlan(data)
    }

    suspend fun updatePlan(token: String, teamId: String, planId: String, status: String): Plan {
        val data = send(
            "PATCH",
            "agent/plans/$planId",
            token,
            listOf("teamId" to teamId),
            JsonValue.obj("status" to JsonValue.Str(status), "teamId" to JsonValue.Str(teamId)),
        )
        return decodePlan(data)
    }

    suspend fun listPlans(token: String, teamId: String, limit: Int = 50, cursor: String? = null): PlanListPage {
        val query = buildList {
            add("teamId" to teamId)
            add("limit" to limit.toString())
            if (cursor != null) add("cursor" to cursor)
        }
        val json = JsonValue.parse(send("GET", "agent/plans", token, query)) ?: throw NuphosApi.Failure.InvalidResponse
        return PlanListPage(
            plans = json["plans"]?.arrayValue?.mapNotNull { Plan.from(it) } ?: emptyList(),
            nextCursor = json["nextCursor"]?.stringValue,
            hasMore = json["hasMore"]?.boolValue ?: false,
        )
    }

    suspend fun planApprovalPolicy(token: String, teamId: String): PlanApprovalRequirement {
        val json = JsonValue.parse(send("GET", "agent/plan-approval-policy", token, listOf("teamId" to teamId)))
            ?: throw NuphosApi.Failure.InvalidResponse
        return PlanApprovalRequirement(json)
    }

    suspend fun updatePlanApprovalPolicy(token: String, teamId: String, minimumOtherApprovals: Int): PlanApprovalRequirement {
        val json = JsonValue.parse(
            send(
                "PUT",
                "agent/plan-approval-policy",
                token,
                body = JsonValue.obj(
                    "teamId" to JsonValue.Str(teamId),
                    "requesterApprovalRequired" to JsonValue.Bool(true),
                    "minimumOtherApprovals" to JsonValue.Number(minimumOtherApprovals.toDouble()),
                ),
            ),
        ) ?: throw NuphosApi.Failure.InvalidResponse
        return PlanApprovalRequirement(json)
    }

    private fun decodePlan(data: String): Plan {
        val json = JsonValue.parse(data) ?: throw NuphosApi.Failure.InvalidResponse
        return Plan.from(json["plan"] ?: json) ?: throw NuphosApi.Failure.InvalidResponse
    }

    sealed class Conflict : Exception() {
        data class TranscriptOutOfSync(val storedMessageCount: Int?) : Conflict() {
            override val message = "The conversation changed elsewhere; resyncing."
        }
        data object StreamNotResumable : Conflict() {
            private fun readResolve(): Any = StreamNotResumable
            override val message = "The previous reply can no longer be resumed."
        }
        data object StreamConflict : Conflict() {
            private fun readResolve(): Any = StreamConflict
            override val message = "That stream belongs to another conversation."
        }
        data object ConversationBusy : Conflict() {
            private fun readResolve(): Any = ConversationBusy
            override val message = "This conversation is busy with another reply."
        }
        data class Other(val code: String?, val serverMessage: String, val status: Int) : Conflict() {
            override val message = serverMessage
        }
    }

    fun conflict(status: Int, body: String?): Conflict {
        var code: String? = null
        var message = body ?: "Nuphos returned status $status."
        var stored: Int? = null
        body?.let { JsonValue.parse(it) }?.let { json ->
            val error = json["error"] ?: json
            code = error["code"]?.stringValue
            message = error["message"]?.stringValue ?: message
            stored = error["details"]?.get("storedMessageCount")?.numberValue?.toInt()
        }
        return when (code) {
            "transcript_out_of_sync" -> Conflict.TranscriptOutOfSync(stored)
            "stream_not_resumable" -> Conflict.StreamNotResumable
            "stream_conflict" -> Conflict.StreamConflict
            "conversation_busy" -> Conflict.ConversationBusy
            else -> Conflict.Other(code, message, status)
        }
    }

    internal suspend fun send(
        method: String,
        path: String,
        token: String,
        query: List<Pair<String, String>> = emptyList(),
        body: JsonValue? = null,
    ): String = withContext(Dispatchers.IO) {
        val url = NuphosApi.BASE_URL.toHttpUrl().newBuilder().addPathSegments(path).apply {
            query.forEach { (k, v) -> addQueryParameter(k, v) }
        }.build()
        val builder = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")
            .header("x-atlas-client", Http.clientHeader())
        val payload = body?.let { Http.json.encodeToString(JsonValue.serializer(), it).toRequestBody(Http.jsonMedia) }
        builder.method(method, if (method == "GET" || method == "HEAD") null else (payload ?: "".toRequestBody(null)))
        Http.client.newCall(builder.build()).execute().use { response ->
            val text = response.body.string()
            when {
                response.isSuccessful -> text
                response.code == 401 -> throw NuphosApi.Failure.Unauthorized
                else -> throw conflict(response.code, text)
            }
        }
    }
}
