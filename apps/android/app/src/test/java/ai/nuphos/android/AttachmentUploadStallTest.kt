package ai.nuphos.android

import ai.nuphos.android.data.AttachmentTransfers
import ai.nuphos.android.model.ComposerAttachment
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/**
 * The production storage transport with its own client and timeouts, reached through the public
 * [AttachmentTransfers.Transport] interface. It uses no entry point added by the retry, so it runs
 * the same way against the code from before the retry existed.
 */
class AttachmentUploadStallTest {
    private val size = 8 * 1024 * 1024
    private val store = Store()
    private val transport = Class.forName("ai.nuphos.android.data.AttachmentTransfers\$NetworkTransport")
        .getDeclaredField("INSTANCE").also { it.isAccessible = true }.get(null) as AttachmentTransfers.Transport

    @After fun stop() = store.close()

    // The store takes the start of the body and then nothing more. After 10 idle seconds the
    // upload goes again, the count drops back to the start, and the second try lands.
    @Test fun stalledUploadGoesAgainAndLands() {
        val pending = AttachmentTransfers().retain(listOf(ComposerAttachment(name = "big.bin",
            kind = ComposerAttachment.Kind.File(byteArrayOf(1), "application/octet-stream"))))
        val progress = Collections.synchronizedList(mutableListOf<Long>())
        val result = runCatching {
            runBlocking { transport.put("http://127.0.0.1:${store.port}/upload", "application/octet-stream", ByteArray(size), pending) { progress += it } }
        }
        assertTrue("a stalled upload did not go again and land: ${result.exceptionOrNull()}", result.isSuccess)
        assertEquals(2, store.connections.get())
        val reset = progress.indexOf(0L)
        assertTrue("the count drops back to the file's start on a retry", reset > 0 && progress[reset - 1] > 0)
        assertEquals(size.toLong(), progress.last())
    }

    private class Store : AutoCloseable {
        val connections = AtomicInteger()
        private val server = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
        private val sockets = Collections.synchronizedList(mutableListOf<Socket>())
        val port get() = server.localPort

        init {
            thread(isDaemon = true) {
                while (!server.isClosed) {
                    val socket = try { server.accept() } catch (_: Exception) { break }
                    sockets += socket
                    val first = connections.incrementAndGet() == 1
                    thread(isDaemon = true) { runCatching { serve(socket, first) } }
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
            socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
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
