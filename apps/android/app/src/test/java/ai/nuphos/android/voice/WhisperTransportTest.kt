package ai.nuphos.android.voice

import java.io.File
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
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
    @Test fun multipartUsesWorkspaceAuthAndBackendContractWithoutProviderModelFields() = runTest {
        val calls = SyntheticCalls(); val transport = NuphosWhisperTransport(calls)
        val file = File.createTempFile("synthetic", ".m4a").apply { writeText("synthetic audio bytes") }
        try {
            assertEquals(Transcript("hello", "english"), transport.transcribe(file, "fixture-nuphos-token", "team-A", "Nuphos"))
            val request = calls.requests.single()
            assertEquals("/teams/team-A/voice-transcriptions", request.url.encodedPath)
            assertEquals("Bearer fixture-nuphos-token", request.header("Authorization"))
            assertNotNull(request.header("x-atlas-client")); assertNull(request.header("Cookie"))
            assertEquals("POST", request.method)
            val body = Buffer().also { request.body!!.writeTo(it) }.readUtf8()
            for (part in listOf("Nuphos", "dictation.m4a", "audio/m4a", "synthetic audio bytes")) assertTrue(part, part in body)
            assertFalse(body.contains("whisper-1")); assertFalse(request.url.host.contains("openai"))
        } finally { file.delete() }
    }
    @Test fun subscriptionAndPermissionErrorsAreTypedWithoutEchoingResponseBodies() = runTest {
        val file = File.createTempFile("synthetic", ".m4a").apply { writeText("audio") }
        try {
            for (status in listOf(401, 402, 403, 413, 429, 503)) {
                val calls = SyntheticCalls(status, """{"error":{"code":"subscription_required","message":"echo secret-token"}}""")
                val e = runCatching { NuphosWhisperTransport(calls).transcribe(file, "secret-token", "A", "") }.exceptionOrNull()
                assertTrue(e is VoiceFailure); assertEquals(status, (e as VoiceFailure).status)
                assertFalse(e.message!!.contains("secret-token"))
                if (status == 402) assertTrue(e.message!!.contains("subscription"))
            }
        } finally { file.delete() }
    }
    @Test fun cancelStopsUnderlyingUpload() = runTest {
        val calls = SyntheticCalls().apply { delay = true }
        val file = File.createTempFile("synthetic", ".m4a").apply { writeText("audio") }
        val job = launch { NuphosWhisperTransport(calls).transcribe(file, "fixture", "A", "") }
        runCurrent()
        job.cancel(); job.join()
        assertTrue(calls.canceled); file.delete()
    }
    @Test fun emptyAndOversizedAudioFailBeforeCreatingAnyRequest() = runTest {
        val calls = SyntheticCalls(); val file = File.createTempFile("synthetic", ".m4a")
        try {
            assertTrue(runCatching { NuphosWhisperTransport(calls).transcribe(file, "fixture", "A", "") }.isFailure)
            java.io.RandomAccessFile(file, "rw").use { it.setLength(NuphosWhisperTransport.MAX_AUDIO_BYTES + 1) }
            assertTrue(runCatching { NuphosWhisperTransport(calls).transcribe(file, "fixture", "A", "") }.isFailure)
            assertTrue(calls.requests.isEmpty())
        } finally { file.delete() }
    }
}
