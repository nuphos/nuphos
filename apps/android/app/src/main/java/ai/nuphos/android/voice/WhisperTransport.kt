package ai.nuphos.android.voice

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
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.Response

interface WhisperTransport {
    suspend fun verify(key: String)
    suspend fun transcribe(file: File, key: String, prompt: String): Transcript
}
data class Transcript(val text: String, val language: String?)
class RejectedVoiceKey : IOException("OpenAI rejected this API key. Tap the microphone to enter a new one.")

/** Separate client: never receives Nuphos auth headers, cookies or session tokens. */
class OpenAIWhisperTransport(private val calls: Call.Factory = OkHttpClient.Builder()
    .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
    .callTimeout(90, TimeUnit.SECONDS).build()) : WhisperTransport {
    override suspend fun verify(key: String) {
        execute(Request.Builder().url("https://api.openai.com/v1/models").header("Authorization", "Bearer $key").build())
    }
    override suspend fun transcribe(file: File, key: String, prompt: String): Transcript {
        require(file.length() in 1..MAX_AUDIO_BYTES) { "The recording is empty or too large. Record a shorter message." }
        val multipart = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("model", "whisper-1").addFormDataPart("response_format", "verbose_json")
        if (prompt.isNotBlank()) multipart.addFormDataPart("prompt", prompt.trim())
        multipart.addFormDataPart("file", "dictation.m4a", file.asRequestBody("audio/m4a".toMediaType()))
        val body = execute(Request.Builder().url("https://api.openai.com/v1/audio/transcriptions")
            .header("Authorization", "Bearer $key").post(multipart.build()).build())
        val reply = runCatching { Json.parseToJsonElement(body).jsonObject }.getOrNull()
        val text = reply?.get("text")?.jsonPrimitive?.contentOrNull
            ?: throw IOException("OpenAI couldn't transcribe the recording.")
        return Transcript(text.trim(), reply["language"]?.jsonPrimitive?.contentOrNull)
    }
    private suspend fun execute(request: Request): String = suspendCancellableCoroutine { continuation ->
        val call = calls.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                continuation.resumeWith(Result.failure(IOException("OpenAI couldn't be reached. Try again.")))
            }
            override fun onResponse(call: Call, response: Response) {
                val result = runCatching {
                    response.use {
                        if (it.code == 401) throw RejectedVoiceKey()
                        // Do not surface an untrusted response body that might echo credentials.
                        if (!it.isSuccessful) throw IOException("OpenAI request failed (${it.code}). Try again.")
                        val source = it.body?.source() ?: throw IOException("OpenAI returned an empty response.")
                        if (source.request(1_048_577)) throw IOException("OpenAI returned an oversized response.")
                        source.readUtf8()
                    }
                }
                continuation.resumeWith(result)
            }
        })
    }
    companion object { const val MAX_AUDIO_BYTES = 24_000_000L }
}
