package ai.nuphos.android.data

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.channels.trySendBlocking
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Request
import okhttp3.Response
import okio.BufferedSource
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

data class SseEvent(val event: String? = null, val data: String, val id: String? = null)

object SseClient {
    sealed class Failure : Exception() {
        data class BadStatus(val code: Int, val body: String?) : Failure() {
            override val message = body ?: "Nuphos returned status $code."
        }
        data class NotEventStream(val type: String?) : Failure() {
            override val message = "Expected an event stream, got ${type ?: "nothing"}."
        }
        data object FirstByteTimeout : Failure() {
            private fun readResolve(): Any = FirstByteTimeout
            override val message = "Nuphos did not start responding in time."
        }
        data object IdleTimeout : Failure() {
            private fun readResolve(): Any = IdleTimeout
            override val message = "The connection went quiet for too long."
        }
    }

    fun events(
        request: Request,
        firstByteTimeoutMs: Long = 5_000,
        idleTimeoutMs: Long = 45_000,
    ): Flow<SseEvent> = callbackFlow {
        val call = Http.chatClient.newCall(request)
        val seen = AtomicBoolean(false)
        val lastByte = AtomicLong(System.nanoTime())
        val closed = AtomicBoolean(false)
        val backpressured = AtomicBoolean(false)

        fun touch() {
            seen.set(true)
            lastByte.set(System.nanoTime())
        }

        val watchdog = launch {
            while (!closed.get()) {
                kotlinx.coroutines.delay(1_000)
                val idleMs = (System.nanoTime() - lastByte.get()) / 1_000_000
                if (!seen.get() && idleMs > firstByteTimeoutMs) {
                    close(Failure.FirstByteTimeout)
                    call.cancel()
                    return@launch
                }
                if (seen.get() && !backpressured.get() && idleMs > idleTimeoutMs) {
                    close(Failure.IdleTimeout)
                    call.cancel()
                    return@launch
                }
            }
        }

        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                closed.set(true)
                close(if (call.isCanceled()) kotlinx.coroutines.CancellationException() else e)
            }

            override fun onResponse(call: Call, response: Response) {
                response.use { res ->
                    if (!res.isSuccessful) {
                        val body = res.body.string().take(4_000)
                        closed.set(true)
                        close(Failure.BadStatus(res.code, errorMessage(body)))
                        return
                    }
                    val contentType = res.header("Content-Type").orEmpty()
                    if (!contentType.contains("text/event-stream")) {
                        closed.set(true)
                        close(Failure.NotEventStream(contentType))
                        return
                    }
                    try {
                        readEvents(res.body.source(), ::touch) { event ->
                            backpressured.set(true)
                            try {
                                trySendBlocking(event).isSuccess
                            } finally {
                                touch()
                                backpressured.set(false)
                            }
                        }
                        closed.set(true)
                        close()
                    } catch (e: Exception) {
                        closed.set(true)
                        close(e)
                    }
                }
            }
        })

        awaitClose {
            closed.set(true)
            watchdog.cancel()
            call.cancel()
        }
    }

    private fun readEvents(source: BufferedSource, touch: () -> Unit, emit: (SseEvent) -> Boolean) {
        var event: String? = null
        var id: String? = null
        val data = StringBuilder()
        var hasData = false
        while (!source.exhausted()) {
            val line = source.readUtf8Line() ?: break
            touch()
            if (line.isEmpty()) {
                if (hasData && !emit(SseEvent(event, data.toString(), id))) return
                event = null
                id = null
                data.clear()
                hasData = false
                continue
            }
            if (line.startsWith(":")) continue
            val colon = line.indexOf(':')
            val field = if (colon < 0) line else line.substring(0, colon)
            var value = if (colon < 0) "" else line.substring(colon + 1)
            if (value.startsWith(" ")) value = value.drop(1)
            when (field) {
                "data" -> {
                    if (hasData) data.append('\n')
                    data.append(value)
                    hasData = true
                }
                "event" -> event = value
                "id" -> id = value
            }
        }
        if (hasData) emit(SseEvent(event, data.toString(), id))
    }

    private fun errorMessage(body: String): String? {
        if (body.isEmpty()) return null
        val json = JsonValue.parse(body) ?: return body
        return json["error"]?.get("message")?.stringValue ?: json["message"]?.stringValue ?: body
    }
}
