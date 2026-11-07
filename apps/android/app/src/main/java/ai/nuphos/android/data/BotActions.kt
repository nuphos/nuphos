package ai.nuphos.android.data

private typealias Request = suspend (String, String, String, List<Pair<String, String>>, JsonValue?) -> String

/** Creating Bots and their 1:1 chats, and turning a Task into a Bot and back. */
object BotActions {
    /** `POST /agent/bots`: a Bot with the picked name and face, on the runtime a new chat would use. */
    suspend fun create(token: String, team: String, title: String, avatar: String,
        runtimeId: String? = null, agentRuntime: String? = null, runtimeLabel: String? = null,
        request: Request = AgentChatApi::send,
    ): String {
        val name = requireNotNull(ConversationActions.validTitle(title)) { "A Bot's name must contain 1–120 characters." }
        // The server rejects a null here, so a value that isn't known is left out.
        val fields = listOfNotNull(
            "title" to JsonValue.Str(name),
            "avatar" to JsonValue.Str(avatar),
            runtimeId?.let { "runtimeId" to JsonValue.Str(it) },
            agentRuntime?.let { "agentRuntime" to JsonValue.Str(it) },
            runtimeLabel?.let { "runtimeLabel" to JsonValue.Str(it) },
        )
        return sessionId(request("POST", "agent/bots", token, listOf("teamId" to team), JsonValue.obj(*fields.toTypedArray())))
    }

    /** The start of a Bot's 1:1 chat: an unnamed chat, so it's called by the Bot. */
    suspend fun createChannel(token: String, team: String, request: Request = AgentChatApi::send): String =
        sessionId(request("POST", "agent/channels", token, listOf("teamId" to team), JsonValue.obj()))

    /** The rest of it: the Bot in the chat. A retry adds to the same chat instead of making another. */
    suspend fun addBot(token: String, team: String, channel: String, botId: String, request: Request = AgentChatApi::send) {
        request("POST", "agent/conversations/${ConversationActions.segment(channel)}/agents", token,
            listOf("teamId" to team), JsonValue.obj("sessionId" to JsonValue.Str(botId)))
    }

    /** Make a Task a Bot, which also asks it to name itself, or take the face away to turn it back. */
    suspend fun setBot(token: String, team: String, session: String, bot: Boolean, request: Request = AgentChatApi::send) {
        val conversation = "agent/conversations/${ConversationActions.segment(session)}"
        val query = listOf("teamId" to team)
        if (bot) request("POST", "$conversation/bot", token, query, JsonValue.obj())
        else request("PATCH", "$conversation/avatar", token, query, JsonValue.obj("avatar" to JsonValue.Null))
    }

    private fun sessionId(response: String): String =
        JsonValue.parse(response)?.get("sessionId")?.stringValue?.takeIf { it.isNotEmpty() } ?: throw NuphosApi.Failure.InvalidResponse
}
