package ai.nuphos.android.data

import ai.nuphos.android.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

internal class ComputerSubscriptionsApi(private val token: String) {
    private val endpoint = "${BuildConfig.PUSH_BASE_URL}/push/computer-subscriptions".toHttpUrl()

    @Serializable
    private data class Subscriptions(val deviceIds: List<String>)

    suspend fun list(): Set<String> = withContext(Dispatchers.IO) {
        val request = Http.authorizedGet(endpoint.toString(), token)
        Http.client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Unable to load subscriptions: ${response.code}")
            val body = response.body.string()
            Http.json.decodeFromString<Subscriptions>(body).deviceIds.toSet()
        }
    }

    suspend fun set(deviceId: String, enabled: Boolean) = withContext(Dispatchers.IO) {
        val url = endpoint.newBuilder().addPathSegment(deviceId).build()
        val body = buildJsonObject { put("enabled", enabled) }
        val request = Http.authorizedGet(url.toString(), token).newBuilder()
            .put(body.toString().toRequestBody(Http.jsonMedia))
            .build()
        Http.client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Unable to update subscription: ${response.code}")
        }
    }
}
