package ai.nuphos.android.data

import ai.nuphos.android.BuildConfig
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

object Http {
    val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = false
        explicitNulls = false
        coerceInputValues = true
    }

    val jsonMedia = "application/json; charset=utf-8".toMediaType()

    val client: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(ConsentInterceptor())
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    val chatClient: OkHttpClient = client.newBuilder()
        .readTimeout(60, TimeUnit.MINUTES)
        .callTimeout(60, TimeUnit.MINUTES)
        .build()

    fun clientHeader(): String = "nuphos-android/${BuildConfig.VERSION_NAME}"

    fun authorizedGet(url: String, token: String, timeoutSeconds: Long = 20): Request =
        Request.Builder()
            .url(url)
            .get()
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")
            .header("x-atlas-client", clientHeader())
            .build()
}
