package ai.nuphos.android.data

import ai.nuphos.android.session.HistoryStatus

object ConversationReadApi {
    data class State(val activitySeq: Long, val readSeq: Long, val unread: Boolean)
    fun payload(teamId: String, seq: Long): JsonValue {
        require(teamId.isNotBlank() && seq in 0..9007199254740991L)
        return JsonValue.obj("teamId" to JsonValue.Str(teamId), "seq" to JsonValue.Number(seq.toDouble()))
    }
    suspend fun mark(token: String, teamId: String, sessionId: String, seq: Long): State {
        val json = JsonValue.parse(AgentChatApi.send("POST", "agent/conversations/${android.net.Uri.encode(sessionId)}/read", token, body = payload(teamId, seq)))
        val activity = HistoryStatus.sequence(json?.get("activitySeq")) ?: throw NuphosApi.Failure.InvalidResponse
        val read = HistoryStatus.sequence(json?.get("readSeq")) ?: throw NuphosApi.Failure.InvalidResponse
        val unread = json?.get("unread")?.boolValue ?: throw NuphosApi.Failure.InvalidResponse
        if (read > activity || unread != (activity > read)) throw NuphosApi.Failure.InvalidResponse
        return State(activity, read, unread)
    }
}
