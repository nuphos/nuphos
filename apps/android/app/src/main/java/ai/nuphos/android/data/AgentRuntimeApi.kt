package ai.nuphos.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.time.Instant
import java.util.UUID

/** Only catalog identity and admission fields are retained, never connection defaults. */
data class AgentRuntime(val id: String, val provider: String, val label: String, val status: String, val kind: String, val deleting: Boolean = false) {
    val selectable get() = id.matches(Regex("[A-Za-z0-9_-]{1,200}")) && provider in setOf("claude-code", "codex") &&
        status == "active" && kind in setOf("managed", "external", "development", "local") && !deleting
}

data class RuntimeBinding(val runtimeId: String, val agentRuntime: String, val displayLabel: String? = null)

/** Authorization fields are memory-only and are removed outside the awaiting state. */
data class RuntimeLogin(val attemptId: String, val state: String, val expiresAt: Long,
    val verificationUri: String? = null, val userCode: String? = null,
    val authorizationUrl: String? = null, val codeSubmitted: Boolean = false) {
    val pending get() = state in setOf("starting", "awaiting_authorization")
    fun valid(now: Long) = now < expiresAt
    val browserUrl get() = (authorizationUrl ?: verificationUri)?.takeIf(::runtimeHttpsUrl)
}
fun runtimeHttpsUrl(value: String): Boolean = runCatching {
    val uri = java.net.URI(value)
    uri.scheme == "https" && !uri.host.isNullOrEmpty() && uri.rawUserInfo == null
}.getOrDefault(false)
fun validRuntimeCode(value: String) = value.matches(Regex("^[A-Za-z0-9_.~-]{1,2048}#[A-Za-z0-9_.~-]{1,512}$"))
class RuntimeLoginAbsent : Exception("No sign-in is in progress for this account.")
class RuntimeHttpFailure(val status: Int, val errorCode: String?) : Exception("Agent request was rejected ($status).")

interface RuntimeTransport {
    suspend fun catalog(): List<AgentRuntime>
    suspend fun create(provider: String, label: String?): AgentRuntime
    suspend fun start(runtimeId: String): RuntimeLogin
    suspend fun login(runtimeId: String): RuntimeLogin
    suspend fun code(runtimeId: String, attemptId: String, code: String): RuntimeLogin
    suspend fun cancel(runtimeId: String, attemptId: String)
}
class AgentRuntimeApi internal constructor(private val token: String, teamId: String, private val client: OkHttpClient) : RuntimeTransport {
    constructor(token: String, teamId: String) : this(token, teamId, Http.client)
    private val path = "teams/$teamId/agent-runtimes"
    init { require(teamId.matches(Regex("[a-fA-F0-9]{24}"))) }
    override suspend fun catalog(): List<AgentRuntime> {
        val list = execute(path, "GET", expected = 200)["runtimes"] as? JsonArray ?: throw NuphosApi.Failure.InvalidResponse
        return list.map(::decodeRuntime).also { if (it.map { item -> item.id }.distinct().size != it.size) throw NuphosApi.Failure.InvalidResponse }
    }
    override suspend fun create(provider: String, label: String?): AgentRuntime {
        require(provider in setOf("claude-code", "codex"))
        val trimmed = label?.trim(); require(trimmed == null || trimmed.length in 1..120)
        return decodeRuntime(execute(path, "POST", buildJsonObject {
            put("provider", provider); trimmed?.let { put("label", it) }
        }.toString(), 201))
    }
    private fun loginPath(id: String): String { require(id.matches(Regex("[A-Za-z0-9_-]{1,200}"))); return "$path/$id/login" }
    override suspend fun start(runtimeId: String) = decodeLogin(execute(loginPath(runtimeId), "POST", "", 202))
    override suspend fun login(runtimeId: String) = decodeLogin(execute(loginPath(runtimeId), "GET", expected = 200))
    override suspend fun code(runtimeId: String, attemptId: String, code: String): RuntimeLogin {
        require(validRuntimeCode(code.trim())); attempt(attemptId)
        return decodeLogin(execute("${loginPath(runtimeId)}/code", "POST", buildJsonObject {
            put("attemptId", attemptId); put("code", code.trim())
        }.toString(), 200))
    }
    override suspend fun cancel(runtimeId: String, attemptId: String) {
        attempt(attemptId)
        execute(loginPath(runtimeId), "DELETE", buildJsonObject { put("attemptId", attemptId) }.toString(), 204)
    }
    private fun attempt(id: String) { require(runCatching { UUID.fromString(id).toString() == id.lowercase() }.getOrDefault(false)) }
    private fun decodeRuntime(value: JsonElement): AgentRuntime = try {
        val obj = value.jsonObject
        fun field(name: String) = (obj[name] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: throw NuphosApi.Failure.InvalidResponse
        AgentRuntime(field("id"), field("provider"), field("label"), field("status"), field("kind"),
            (obj["deletion"] as? JsonObject)?.get("state")?.jsonPrimitive?.contentOrNull == "deleting")
            .also { if (!it.id.matches(Regex("[A-Za-z0-9_-]{1,200}"))) throw NuphosApi.Failure.InvalidResponse }
    } catch (_: Exception) { throw NuphosApi.Failure.InvalidResponse }
    private fun decodeLogin(obj: JsonObject): RuntimeLogin = try {
        fun field(name: String) = (obj[name] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val id = field("attemptId") ?: throw NuphosApi.Failure.InvalidResponse; attempt(id)
        val state = field("state") ?: throw NuphosApi.Failure.InvalidResponse
        if (state !in setOf("starting", "awaiting_authorization", "connected", "failed", "cancelled")) throw NuphosApi.Failure.InvalidResponse
        val expiry = Instant.parse(field("expiresAt")).toEpochMilli()
        RuntimeLogin(id, state, expiry,
            if (state == "awaiting_authorization") field("verificationUri") else null,
            if (state == "awaiting_authorization") field("userCode") else null,
            if (state == "awaiting_authorization") field("authorizationUrl") else null,
            state == "awaiting_authorization" && obj["codeSubmitted"]?.jsonPrimitive?.booleanOrNull == true)
    } catch (_: Exception) { throw NuphosApi.Failure.InvalidResponse }
    private suspend fun execute(path: String, method: String, body: String? = null, expected: Int): JsonObject = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("${NuphosApi.BASE_URL}/$path")
            .header("Authorization", "Bearer $token").header("Accept", "application/json")
            .header("x-atlas-client", Http.clientHeader()).method(method, body?.toRequestBody(Http.jsonMedia)).build()
        client.newCall(request).execute().use { response ->
            val text = response.body.string()
            if (response.code == 401) throw NuphosApi.Failure.Unauthorized
            if (!response.isSuccessful) {
                val code = runCatching { Http.json.parseToJsonElement(text).jsonObject["error"]?.jsonObject?.get("code")?.jsonPrimitive?.contentOrNull }.getOrNull()
                if (response.code == 404 && code == "runtime_login_not_found") throw RuntimeLoginAbsent()
                throw RuntimeHttpFailure(response.code, code)
            }
            if (response.code != expected) throw NuphosApi.Failure.InvalidResponse
            if (expected == 204) JsonObject(emptyMap()) else try { Http.json.parseToJsonElement(text).jsonObject }
            catch (_: Exception) { throw NuphosApi.Failure.InvalidResponse }
        }
    }
}
