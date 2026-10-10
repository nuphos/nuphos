package ai.nuphos.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl

fun interface BrowsingTransport {
    suspend fun get(teamId: String, path: String): JsonValue
}
class BrowsingHttpFailure(val code: Int) : Exception("Could not load this page ($code).")
class BrowsingApi(private val token: String) : BrowsingTransport {
    override suspend fun get(teamId: String, path: String): JsonValue = withContext(Dispatchers.IO) {
        require(teamId.isNotBlank())
        require(path in setOf("monitoring/overview", "agent-triggers", "agent-triggers/scheduler-status"))
        val url = NuphosApi.BASE_URL.toHttpUrl().newBuilder().addPathSegment("teams")
            .addPathSegment(teamId).addPathSegments(path).build()
        Http.client.newCall(Http.authorizedGet(url.toString(), token)).execute().use { response ->
            if (!response.isSuccessful) throw BrowsingHttpFailure(response.code)
            JsonValue.parse(response.body.string()) ?: throw NuphosApi.Failure.InvalidResponse
        }
    }
}
