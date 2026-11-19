package ai.nuphos.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/** Only presentation fields survive the device response. */
data class BoxInventory(val devices: List<RuntimeDevice>, val offered: Boolean)
interface BoxTransport {
    suspend fun inventory(): BoxInventory
    suspend fun createBox(label: String): String
    suspend fun resumeBox(deviceId: String)
}
class BoxApi internal constructor(private val token: String, private val teamId: String, private val client: OkHttpClient) : BoxTransport {
    constructor(token: String, teamId: String) : this(token, teamId, Http.client.newBuilder().readTimeout(60, TimeUnit.SECONDS).callTimeout(65, TimeUnit.SECONDS).build())
    init { require(teamId.matches(Regex("[a-fA-F0-9]{24}"))) }
    override suspend fun inventory(): BoxInventory {
        val result = request("agent/devices?teamId=$teamId", "GET", null, 200)
        return BoxInventory(decodeRuntimeDevices(result), result["boxAvailable"]?.jsonPrimitive?.booleanOrNull == true && result["canCreateBox"]?.jsonPrimitive?.booleanOrNull == true)
    }
    override suspend fun createBox(label: String): String {
        require(label.trim().length in 1..200)
        val result = request("agent/devices/boxes", "POST", buildJsonObject { put("teamId", teamId); put("label", label.trim()) }, 201)
        return result["deviceId"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() && it.length <= 200 } ?: throw NuphosApi.Failure.InvalidResponse
    }
    override suspend fun resumeBox(deviceId: String) {
        require(deviceId.isNotBlank() && deviceId.length <= 200)
        val id = java.net.URLEncoder.encode(deviceId, "UTF-8").replace("+", "%20")
        request("agent/devices/$id/box/resume?teamId=$teamId", "POST", buildJsonObject {}, 200)
    }
    private suspend fun request(path: String, method: String, body: JsonObject?, status: Int): JsonObject = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("${NuphosApi.baseUrl(token)}/$path").header("Authorization", "Bearer $token")
            .header("Accept", "application/json").header("x-atlas-client", Http.clientHeader())
            .method(method, body?.toString()?.toRequestBody(Http.jsonMedia)).build()
        client.newCall(request).execute().use { response ->
            val result = runCatching { Http.json.parseToJsonElement(response.body.string()).jsonObject }.getOrNull()
            if (response.code == 401) throw NuphosApi.Failure.Unauthorized
            if (!response.isSuccessful) {
                val failure = result?.get("error") as? JsonObject
                throw RuntimeHttpFailure(response.code, failure?.get("code")?.jsonPrimitive?.contentOrNull, failure?.get("message")?.jsonPrimitive?.contentOrNull)
            }
            if (response.code != status || result == null) throw NuphosApi.Failure.InvalidResponse
            result
        }
    }
}
