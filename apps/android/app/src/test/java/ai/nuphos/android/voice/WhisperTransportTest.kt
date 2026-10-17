package ai.nuphos.android.voice

import java.io.File
import kotlinx.coroutines.test.runTest
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import okio.Timeout
import org.junit.Assert.*
import org.junit.Test

class WhisperTransportTest {
    private class SyntheticCalls(val status: Int = 200, val reply: String = """{"text":" hello ","language":"english"}""") : Call.Factory {
        val requests = mutableListOf<Request>()
        var canceled = false
        var pending: Callback? = null
        var delay = false
        override fun newCall(request: Request): Call {
            requests.add(request)
            return object : Call {
                override fun request() = request
                override fun enqueue(responseCallback: Callback) {
                    if (delay) { pending = responseCallback; return }
                    responseCallback.onResponse(this, execute())
                }
                override fun execute() = Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                    .code(status).message("Synthetic fixture").body(reply.toResponseBody()).build()
                override fun cancel() { canceled = true }
                override fun isCanceled() = canceled
                override fun isExecuted() = true
                override fun timeout() = Timeout.NONE
                override fun clone(): Call = throw UnsupportedOperationException()
            }
        }
    }
    @Test fun multipartUsesOnlyUserKeyAndMatchesIOSContract() = runTest {
        val calls = SyntheticCalls(); val transport = OpenAIWhisperTransport(calls)
        val file = File.createTempFile("synthetic", ".m4a").apply { writeText("synthetic audio bytes") }
        try {
            assertEquals(Transcript("hello", "english"), transport.transcribe(file, "synthetic-key", "Nuphos"))
            val request = calls.requests.single()
            assertEquals("https://api.openai.com/v1/audio/transcriptions", request.url.toString())
            assertEquals("Bearer synthetic-key", request.header("Authorization"))
            assertNull(request.header("Cookie"))
            val body = Buffer().also { request.body!!.writeTo(it) }.readUtf8()
            for (part in listOf("whisper-1", "verbose_json", "Nuphos", "dictation.m4a", "audio/m4a", "synthetic audio bytes")) assertTrue(part, part in body)
        } finally { file.delete() }
    }
    @Test fun verifyIsFreeModelsReadAnd401HasTypedError() = runTest {
        val calls = SyntheticCalls(401)
        val error = runCatching { OpenAIWhisperTransport(calls).verify("synthetic") }.exceptionOrNull()
        assertTrue(error is RejectedVoiceKey)
        assertEquals("GET", calls.requests.single().method)
        assertEquals("https://api.openai.com/v1/models", calls.requests.single().url.toString())
    }
    @Test fun errorsNeverExposeResponseBodyOrKey() = runTest {
        val error = runCatching { OpenAIWhisperTransport(SyntheticCalls(429, "echo secret-key")).verify("secret-key") }.exceptionOrNull()
        assertFalse(error!!.message!!.contains("secret-key"))
        assertTrue(error.message!!.contains("429"))
    }
}
