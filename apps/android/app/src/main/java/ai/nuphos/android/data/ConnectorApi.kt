package ai.nuphos.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

fun interface ConnectorTransport {
    suspend fun request(method: String, teamId: String, path: String, body: JsonValue?, query: Map<String, String>): JsonValue
}
class ConnectorHttpFailure(val code: Int) : Exception("The connector request failed ($code). Refresh connections before retrying.")
class ConnectorApi(private val token: String) : ConnectorTransport {
    override suspend fun request(method: String, teamId: String, path: String, body: JsonValue?, query: Map<String, String>): JsonValue = withContext(Dispatchers.IO) {
        val url = NuphosApi.BASE_URL.toHttpUrl().newBuilder().addPathSegment("teams").addPathSegment(teamId).addPathSegments(path).apply {
            query.forEach { (key, value) -> addQueryParameter(key, value) }
        }.build()
        val payload = body?.let { Http.json.encodeToString(JsonValue.serializer(), it).toRequestBody(Http.jsonMedia) }
        val request = Request.Builder().url(url).header("Authorization", "Bearer $token")
            .header("Accept", "application/json").header("x-atlas-client", Http.clientHeader())
            .method(method, if (method == "POST") payload ?: "{}".toRequestBody(Http.jsonMedia) else payload).build()
        Http.client.newCall(request).execute().use { response ->
            // Server errors can contain submitted credentials. Never surface raw response text.
            if (!response.isSuccessful) throw ConnectorHttpFailure(response.code)
            val text = response.body.string()
            if (text.isBlank()) JsonValue.Null else JsonValue.parse(text) ?: throw NuphosApi.Failure.InvalidResponse
        }
    }
}
