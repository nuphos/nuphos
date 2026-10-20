package ai.nuphos.android.data

import kotlinx.serialization.Serializable

/** Only controls advertised by this runtime are offered. IDs are opaque for live sessions. */
@Serializable
data class SessionConfigState(val status: String, val options: List<Option>) {
    @Serializable data class Choice(val value: String, val name: String, val description: String? = null)
    @Serializable data class Option(val id: String, val name: String, val kind: String,
        val currentValue: String, val options: List<Choice>, val description: String? = null) {
        val visibleChoices get() = options.filter { kind == "fast" || (it.value.lowercase() != "default" && it.name.lowercase() !in defaultNames) }
        val label: String get() {
            val current = options.firstOrNull { it.value == currentValue }
            if (kind == "model" && (currentValue.lowercase() == "default" || current?.name?.lowercase() in defaultNames))
                return visibleChoices.firstOrNull { current?.description?.contains(it.name, ignoreCase = true) == true }?.name ?: "Model"
            return current?.name ?: currentValue
        }
    }
    val editable get() = status in setOf("ready", "busy", "dormant") && options.isNotEmpty()
    val modelTitle get() = options.firstOrNull { it.kind == "model" }?.label ?: if (status == "offline") "Model unavailable" else "Model"
    fun allows(id: String, value: String) = options.any { it.id == id && it.visibleChoices.any { choice -> choice.value == value } }
    fun retaining(previous: SessionConfigState?) = if (options.isEmpty() && status in setOf("busy", "dormant", "offline")) copy(options = previous?.options.orEmpty()) else this
    companion object { private val defaultNames = setOf("default", "default model", "agent default", "runtime default") }
}

object ModelSettingsApi {

    suspend fun newConfig(token: String, team: String, runtime: String, pick: Map<String, String>, send: suspend (String, String, String, List<Pair<String, String>>, JsonValue?) -> String = AgentChatApi::send): SessionConfigState {
        require(pick.keys.all { it in setOf("model", "effort", "fast") })
        return decode(send("GET", "teams/${segment(team)}/agent-runtimes/${segment(runtime)}/model-config", token, pick.toList(), null))
    }
    suspend fun read(token: String, team: String, session: String, send: suspend (String, String, String, List<Pair<String, String>>, JsonValue?) -> String = AgentChatApi::send): SessionConfigState = decode(
        send("GET", "agent/conversations/${segment(session)}/model-config", token, listOf("teamId" to team), null))
    suspend fun write(token: String, team: String, session: String, id: String, value: String, send: suspend (String, String, String, List<Pair<String, String>>, JsonValue?) -> String = AgentChatApi::send): SessionConfigState = decode(
        send("PATCH", "agent/conversations/${segment(session)}/model-config", token, listOf("teamId" to team),
            JsonValue.obj("configId" to JsonValue.Str(id), "value" to JsonValue.Str(value))))
    private fun segment(value: String) = java.net.URLEncoder.encode(value, "UTF-8").replace("+", "%20")
    private fun decode(raw: String): SessionConfigState = Http.json.decodeFromString<SessionConfigState>(raw).also { state ->
        require(state.status in setOf("ready", "busy", "dormant", "offline", "unsupported"))
        require(state.options.map { it.id }.distinct().size == state.options.size)
        require(state.options.all { it.kind in setOf("model", "effort", "fast") })
    }
}
