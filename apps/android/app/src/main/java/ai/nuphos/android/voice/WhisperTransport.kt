package ai.nuphos.android.voice

import ai.nuphos.android.BuildConfig
import ai.nuphos.android.data.Http
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.Response

interface WhisperTransport {
    suspend fun transcribe(file: File, token: String, teamId: String, prompt: String): Transcript
}
data class Transcript(val text: String, val language: String?)

/** Messages are fixed client copy: never display a response body or echo credentials. */
class VoiceFailure(val status: Int, val code: String? = null) : IOException(when (status) {
    401 -> "Your sign-in has expired. Sign in again to use voice input."
    402 -> "Voice input is included with a Nuphos subscription. Choose a subscribed workspace to continue."
    403 -> if (code == "ai_consent_required") "Confirm your AI sharing choice before using voice input."
        else "Your account does not have access to voice input in this workspace."
    413 -> "The recording is too long to transcribe. Record a shorter message."
    429 -> "Voice input is busy. Wait a moment and try again."
    503 -> if (code == "voice_unavailable") "Voice input is not available on this server."
        else "The recording couldn't be transcribed. Please try again."
    else -> "Voice input failed. Check your connection and try again."
})

/** Nuphos owns the provider key; consent and account authentication stay on the normal client. */
class NuphosWhisperTransport(
    private val calls: Call.Factory = Http.client.newBuilder()
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .readTimeout(90, TimeUnit.SECONDS).writeTimeout(90, TimeUnit.SECONDS).callTimeout(90, TimeUnit.SECONDS).build(),
    private val baseUrl: String = BuildConfig.API_BASE_URL,
) : WhisperTransport {
    override suspend fun transcribe(file: File, token: String, teamId: String, prompt: String): Transcript {
        require(token.isNotBlank() && teamId.isNotBlank()) { "Choose a workspace and sign in to use voice input." }
        require(file.length() in 1..MAX_AUDIO_BYTES) { "The recording is empty or too large. Record a shorter message." }
        val multipart = MultipartBody.Builder().setType(MultipartBody.FORM)
        if (prompt.isNotBlank()) multipart.addFormDataPart("prompt", prompt.trim())
        multipart.addFormDataPart("file", "dictation.m4a", file.asRequestBody("audio/m4a".toMediaType()))
        val url = baseUrl.trimEnd('/').toHttpUrl().newBuilder()
            .addPathSegment("teams").addPathSegment(teamId).addPathSegment("voice-transcriptions").build()
        val body = execute(Request.Builder().url(url)
            .header("Authorization", "Bearer $token").header("x-atlas-client", Http.clientHeader())
            .header("Accept", "application/json").post(multipart.build()).build())
        val reply = runCatching { Json.parseToJsonElement(body).jsonObject }.getOrNull()
        val text = reply?.get("text")?.jsonPrimitive?.contentOrNull ?: throw VoiceFailure(503)
        return Transcript(text.trim(), reply["language"]?.jsonPrimitive?.contentOrNull)
    }
    private suspend fun execute(request: Request): String = suspendCancellableCoroutine { continuation ->
        val call = calls.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) continuation.resumeWith(Result.failure(VoiceFailure(0)))
            }
            override fun onResponse(call: Call, response: Response) {
                val result = runCatching {
                    response.use {
                        val source = it.body?.source() ?: throw VoiceFailure(503)
                        if (source.request(1_048_577)) throw VoiceFailure(503)
                        val body = source.readUtf8()
                        if (it.code != 200) {
                            val code = runCatching { Json.parseToJsonElement(body).jsonObject["error"]?.jsonObject
                                ?.get("code")?.jsonPrimitive?.contentOrNull }.getOrNull()
                            throw VoiceFailure(it.code, code)
                        }
                        body
                    }
                }
                if (continuation.isActive) continuation.resumeWith(result)
            }
        })
    }
    companion object { const val MAX_AUDIO_BYTES = 25L * 1024 * 1024 }
}
