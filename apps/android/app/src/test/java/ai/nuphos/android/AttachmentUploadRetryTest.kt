package ai.nuphos.android

import ai.nuphos.android.data.AttachmentTransfers
import ai.nuphos.android.model.ComposerAttachment
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

class AttachmentUploadRetryTest {
    private val size = 8 * 1024 * 1024
    private val client = OkHttpClient.Builder().writeTimeout(1, TimeUnit.SECONDS).readTimeout(1, TimeUnit.SECONDS).build()
    private val store = Store()

    @After fun stop() = store.close()

    private fun send(progress: MutableList<Long> = mutableListOf()): Result<Unit> {
        val pending = AttachmentTransfers().retain(listOf(ComposerAttachment(name = "big.bin", kind = ComposerAttachment.Kind.File(byteArrayOf(1), "application/octet-stream"))))
        val request = AttachmentTransfers.storageRequest("http://127.0.0.1:${store.port}/upload", "application/octet-stream", ByteArray(size), {}) { progress += it }
        return runCatching { runBlocking { AttachmentTransfers.NetworkTransport.send(client, request, pending, { progress += it }, pause = 100) } }
    }

    // A store that takes the start of the body and then nothing more: the send times out on the
    // idle limit and goes again, and the second try lands.
    @Test fun stalledUploadGoesAgainAndLands() {
        store.stallFirst = 1
        val progress = Collections.synchronizedList(mutableListOf<Long>())
        val result = send(progress)
        assertTrue("a stalled upload did not go again and land: ${result.exceptionOrNull()}", result.isSuccess)
        assertEquals(2, store.connections.get())
        val reset = progress.indexOf(0L)
        assertTrue("the count drops back to the file's start on a retry", reset > 0 && progress[reset - 1] > 0)
        assertEquals(size.toLong(), progress.last())
    }

    @Test fun stopsAfterThreeTries() {
        store.stallFirst = Int.MAX_VALUE
        val result = send()
        assertTrue(result.isFailure)
        assertEquals("tries before the message fails", 3, store.connections.get())
    }

    @Test fun storeHttpErrorIsNotRetried() {
        store.status = 500
        val result = send()
        assertTrue(result.exceptionOrNull() is AttachmentTransfers.Failure)
        assertEquals(1, store.connections.get())
    }

    private class Store : AutoCloseable {
        @Volatile var stallFirst = 0
        @Volatile var status = 200
        val connections = AtomicInteger()
        private val server = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
        private val sockets = Collections.synchronizedList(mutableListOf<Socket>())
        val port get() = server.localPort

        init {
            thread(isDaemon = true) {
                while (!server.isClosed) {
                    val socket = try { server.accept() } catch (_: Exception) { break }
                    sockets += socket
                    val number = connections.incrementAndGet()
                    thread(isDaemon = true) { runCatching { serve(socket, number <= stallFirst) } }
                }
            }
        }

        private fun serve(socket: Socket, stall: Boolean) {
            val input = socket.getInputStream()
            val length = headers(input).lines().first { it.startsWith("content-length:", ignoreCase = true) }.substringAfter(':').trim().toLong()
            var left = if (stall) 64L * 1024 else length
            val buffer = ByteArray(8192)
            while (left > 0) {
                val count = input.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
                if (count < 0) return
                left -= count
            }
            if (stall) return // Holds the socket open and reads nothing more.
            socket.getOutputStream().write("HTTP/1.1 $status X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
            socket.getOutputStream().flush()
        }

        private fun headers(input: InputStream): String {
            val text = StringBuilder()
            while (!text.endsWith("\r\n\r\n")) {
                val byte = input.read()
                if (byte < 0) break
                text.append(byte.toChar())
            }
            return text.toString()
        }

        override fun close() {
            server.close()
            synchronized(sockets) { sockets.forEach { runCatching { it.close() } } }
        }
    }
}
