package ai.nuphos.android.session

import androidx.compose.runtime.MutableState
import ai.nuphos.android.data.*
import ai.nuphos.android.model.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.resetMain
import org.junit.Assert.*
import org.junit.Test
import java.net.ServerSocket
import java.nio.file.Files
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ServerQueueAdmissionTest {
    @Suppress("UNCHECKED_CAST") private fun state(session: ChatSession, name: String, value: Any?) {
        (field(session, name + "\$delegate") as MutableState<Any?>).value = value
    }
    private fun field(session: ChatSession, name: String): Any? =
        ChatSession::class.java.getDeclaredField(name).also { it.isAccessible = true }.get(session)
    private fun write(session: ChatSession, name: String, value: Any?) =
        ChatSession::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(session, value)

    private fun response(status: Int) = runBlocking {
        Dispatchers.setMain(Dispatchers.Unconfined)
        AiAccess.activate("synthetic-queue"); AiAccess.grant("synthetic-queue")
        val directory = Files.createTempDirectory("queue-admission").toFile()
        val original = OwnedAttachmentFile.copy(directory, "original".byteInputStream(), 100) {}
        val prepared = OwnedAttachmentFile.copy(directory, "prepared".byteInputStream(), 100) {}
        val attachment = ComposerAttachment(name = "note.txt", kind = ComposerAttachment.Kind.RetainedFile(original, "text/plain"))
        val preparedAttachment = ComposerAttachment(name = "prepared.txt", kind = ComposerAttachment.Kind.RetainedFile(prepared, "text/plain"))
        val executor = Executors.newSingleThreadExecutor()
        var session: ChatSession? = null
        try {
            ServerSocket(0).use { server ->
                val served = executor.submit {
                    server.accept().use { socket ->
                        val input = socket.getInputStream().bufferedReader()
                        var length = 0
                        while (true) {
                            val line = input.readLine() ?: break
                            if (line.isEmpty()) break
                            if (line.startsWith("Content-Length:", true)) length = line.substringAfter(':').trim().toInt()
                        }
                        if (length > 0) { val chars = CharArray(length); var read = 0; while (read < length) { val n = input.read(chars, read, length - read); if (n < 0) break; read += n } }
                        val body = if (status == 202) """{"status":"queued"}""" else """{"error":{"message":"Synthetic failure"}}"""
                        socket.getOutputStream().apply {
                            write(("HTTP/1.1 $status Test\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n$body").toByteArray()); flush()
                        }
                    }
                }
                val requests = AtomicInteger()
                val detail = AgentConversationDetail(agentRuntime = "openab", isOwner = true,
                    runtimeState = JsonValue.parse("""{"schemaVersion":2,"phase":"running","actions":{"send":false,"reply":false,"steer":false}}"""))
                val chat = ChatSession("synthetic-queue", "team", readDetail = { _, _, _ -> detail }, readEvents = { request ->
                    requests.incrementAndGet()
                    // Exercise the real HTTP/SSE 202 parser without sending a bearer to the test socket.
                    SseClient.events(request.newBuilder().url("http://127.0.0.1:${server.localPort}/chat")
                        .removeHeader("Authorization").build())
                })
                session = chat
                state(chat, "loaded", true); state(chat, "agentRuntime", "openab")
                state(chat, "runtimeObservation", RuntimeObservation(detail.runtimeState!!, RuntimeObservation.now()))
                write(chat, "preparedTransfer", AttachmentTransfers().retain(listOf(preparedAttachment)))
                val send = ChatSession::class.java.getDeclaredMethod("sendPrepared", ComposerSubmission::class.java, String::class.java).also { it.isAccessible = true }
                assertEquals(true, send.invoke(chat, ComposerSubmission("Queued note", listOf(attachment)), "Synthetic transfer instruction"))
                withTimeout(5_000) { while (chat.isStreaming || requests.get() == 0) delay(10) }
                served.get()
                assertEquals(1, requests.get())
                if (status == 202) {
                    assertFalse(original.exists); assertFalse(prepared.exists)
                    assertNull(field(chat, "preparedTransfer")); assertNull(field(chat, "pendingSubmission"))
                    assertTrue(chat.messages.none { it.role == ChatMessage.Role.User })
                    assertFalse(chat.runtimeRecoveryRequired); assertNull(chat.error)
                    assertEquals(1, chat.queuedSends)
                } else {
                    assertTrue(original.exists); assertTrue(prepared.exists)
                    assertNotNull(field(chat, "pendingSubmission")); assertTrue(chat.runtimeRecoveryRequired)
                }
            }
        } finally {
            session?.disposeForConsent(); AiAccess.revoke(); Dispatchers.resetMain()
            executor.shutdownNow(); directory.deleteRecursively()
        }
    }
    @Test fun actual202WithoutSseFramesTransfersAttachmentOwnershipAndDoesNotResend() = response(202)
    @Test fun unconfirmed500KeepsBothOriginalAndPreparedCopies() = response(500)
}
