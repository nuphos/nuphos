package ai.nuphos.android.data

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Test
import java.net.ServerSocket
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class SseClientTest {
    @Test fun slowConsumerReceivesBurstIncludingTerminalEvent() = runBlocking {
        ServerSocket(0).use { server ->
            val executor = Executors.newSingleThreadExecutor()
            val writer = executor.submit {
                server.accept().use { socket ->
                    val body = (0 until 300).joinToString("") { "id: $it\ndata: event-$it\n\n" } + "event: done\ndata: final\n\n"
                    val output = socket.getOutputStream()
                    output.write(("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: ${body.toByteArray().size}\r\nConnection: close\r\n\r\n" + body).toByteArray())
                    output.flush()
                }
            }
            try {
                val result = withTimeout(10_000) {
                    SseClient.events(Request.Builder().url("http://127.0.0.1:${server.localPort}/stream").build(), idleTimeoutMs = 100)
                        .onEach { if (it.data == "event-0") delay(1_500) else delay(3) }.toList()
                }
                assertEquals(301, result.size)
                assertEquals((0 until 300).map { "event-$it" }, result.dropLast(1).map { it.data })
                assertEquals(SseEvent("done", "final"), result.last())
                writer.get(2, TimeUnit.SECONDS)
                Unit
            } finally { executor.shutdownNow() }
        }
    }
    @Test fun cancelingSlowConsumerClosesNetworkAndReleasesProducer() = runBlocking {
        ServerSocket(0).use { server ->
            val executor = Executors.newSingleThreadExecutor()
            val disconnected = executor.submit<Boolean> {
                server.accept().use { socket ->
                    socket.soTimeout = 3_000
                    val input = socket.getInputStream().bufferedReader()
                    while (input.readLine()?.isNotEmpty() == true) { }
                    val body = (0 until 1_000).joinToString("") { "data: event-$it\n\n" }
                    socket.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: ${body.toByteArray().size}\r\n\r\n" + body).toByteArray())
                    socket.getOutputStream().flush()
                    try { input.read() == -1 } catch (_: java.net.SocketException) { true }
                }
            }
            try {
                withTimeout(5_000) {
                    SseClient.events(Request.Builder().url("http://127.0.0.1:${server.localPort}/stream").build())
                        .onEach { delay(100) }.take(1).collect()
                }
                assertTrue(disconnected.get(3, TimeUnit.SECONDS))
                Unit
            } finally { executor.shutdownNow() }
        }
    }

    @Test fun silentNetworkStillRaisesIdleTimeout() = runBlocking {
        ServerSocket(0).use { server ->
            val executor = Executors.newSingleThreadExecutor()
            val disconnected = executor.submit<Boolean> {
                server.accept().use { socket ->
                    socket.soTimeout = 3_000
                    val input = socket.getInputStream().bufferedReader()
                    while (input.readLine()?.isNotEmpty() == true) { }
                    socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n3\r\n:x\n\r\n".toByteArray())
                    socket.getOutputStream().flush()
                    try { input.read() == -1 } catch (_: java.net.SocketException) { true }
                }
            }
            try {
                try {
                    withTimeout(4_000) {
                        SseClient.events(Request.Builder().url("http://127.0.0.1:${server.localPort}/stream").build(), idleTimeoutMs = 100).collect()
                    }
                    fail("Silence completed normally")
                } catch (e: SseClient.Failure.IdleTimeout) { }
                assertTrue(disconnected.get(3, TimeUnit.SECONDS))
                Unit
            } finally { executor.shutdownNow() }
        }
    }

}
