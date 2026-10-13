package ai.nuphos.android.data

import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.Closeable
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.atomic.AtomicBoolean

/** One in-memory attempt. Secrets and delivery codes never travel in an intent. */
class NativeLogin internal constructor(
    private val client: OkHttpClient = Http.client,
    private val timeoutMs: Int = 5 * 60 * 1000,
) : Closeable {
    private val server = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
    private val closed = AtomicBoolean(false)
    private val claimed = AtomicBoolean(false)
    @Volatile private var accepted: Socket? = null
    @Volatile private var activeCall: okhttp3.Call? = null
    private val state = randomSecret()
    private var verifier: String? = randomSecret()
    private var handle: String? = null
    private val deadline = System.nanoTime() + timeoutMs.toLong() * 1_000_000
    val receivedCallback: Boolean get() = claimed.get()

    fun register(): String {
        checkOpen()
        check(handle == null)
        val challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(
            MessageDigest.getInstance("SHA-256").digest(requireNotNull(verifier).toByteArray(Charsets.US_ASCII)))
        val result = post("session", buildJsonObject {
            put("redirectUri", "http://127.0.0.1:${server.localPort}/callback")
            put("codeChallenge", challenge)
            put("codeChallengeMethod", "S256")
            put("clientState", state)
        })
        val registered = result["handle"]?.jsonPrimitive?.takeIf { it.isString }?.content
            ?.takeIf { it.matches(Regex("[A-Za-z0-9_-]{43}")) }
            ?: throw IOException("Nuphos could not start secure sign-in. Please try again.")
        checkOpen()
        handle = registered
        return NuphosWeb.loginUrl(registered)
    }

    /** Called on an IO thread. Close interrupts both the listener and HTTPS calls. */
    fun awaitToken(): String = redeem(awaitDelivery())

    /** Receive the local callback without using the network while the browser is foreground. */
    internal fun awaitDelivery(): String {
        checkOpen()
        requireNotNull(handle)
        while (true) {
            checkOpen()
            val remaining = (deadline - System.nanoTime()) / 1_000_000
            if (remaining <= 0) throw SocketTimeoutException("Sign-in expired. Please try again.")
            server.soTimeout = remaining.coerceAtMost(Int.MAX_VALUE.toLong()).toInt().coerceAtLeast(1)
            val socket = server.accept()
            accepted = socket
            try {
                checkOpen()
                socket.soTimeout = remaining.coerceAtMost(1_000).toInt().coerceAtLeast(1)
                val line = readRequestLine(socket)
                val fields = line?.split(' ')
                val result = if (fields?.size == 3 && fields[0] == "GET" && fields[2] in setOf("HTTP/1.0", "HTTP/1.1"))
                    NuphosWeb.parseDelivery(fields[1], state) else null
                if (result == null) {
                    respond(socket, 400, "Invalid sign-in request.")
                    continue
                }
                checkOpen()
                if (!claimed.compareAndSet(false, true)) throw IOException("Sign-in already completed.")
                // Mark delivery before responding: resuming the app must not cancel redemption.
                respond(socket, 200, "<p>Return to Nuphos to finish sign-in.</p><a href=\"nuphos://google-callback\">Return to Nuphos</a>")
                server.close()
                if (result is NuphosWeb.CallbackResult.Failure) throw IOException(result.message)
                return (result as NuphosWeb.CallbackResult.Code).code
            } catch (_: SocketTimeoutException) {
                // A partial local request must not consume the real attempt.
                if (claimed.get()) throw SocketTimeoutException("Sign-in expired. Please try again.")
            } finally {
                socket.close()
                accepted = null
            }
        }
    }

    /** The host must resume before exchanging a delivered code over HTTPS. */
    internal fun redeem(code: String): String {
        checkOpen()
        check(receivedCallback)
        val redeemed = post("session/redeem", buildJsonObject {
            put("handle", requireNotNull(handle))
            put("codeVerifier", requireNotNull(verifier))
            put("code", code)
        })
        checkOpen()
        return redeemed["token"]?.jsonPrimitive?.takeIf { it.isString }?.content
            ?.takeIf { it.isNotBlank() } ?: throw IOException("Nuphos could not confirm sign-in. Please try again.")
    }

    private fun post(path: String, body: JsonObject): JsonObject {
        checkOpen()
        val call = client.newCall(Request.Builder().url("${NuphosApi.BASE_URL}/auth/native/$path")
            .header("Accept", "application/json").header("x-atlas-client", Http.clientHeader())
            .post(body.toString().toRequestBody(Http.jsonMedia)).build())
        activeCall = call
        try {
            checkOpen()
            return call.execute().use { response ->
                if (!response.isSuccessful) throw IOException("Secure sign-in is unavailable. Please try again.")
                Http.json.parseToJsonElement(response.body.string()).jsonObject
            }
        } finally { activeCall = null }
    }

    private fun checkOpen() {
        if (closed.get()) throw IOException("Sign-in was canceled.")
        if (System.nanoTime() >= deadline) throw SocketTimeoutException("Sign-in expired. Please try again.")
    }

    override fun close() {
        closed.set(true)
        activeCall?.cancel()
        runCatching { accepted?.close() }
        runCatching { server.close() }
        verifier = null
        handle = null
    }

    private fun readRequestLine(socket: Socket): String? {
        val input = socket.getInputStream()
        val headers = StringBuilder()
        val readDeadline = minOf(deadline, System.nanoTime() + 1_000_000_000)
        repeat(8_192) {
            val remaining = (readDeadline - System.nanoTime()) / 1_000_000
            if (remaining <= 0) throw SocketTimeoutException("Sign-in request timed out.")
            socket.soTimeout = remaining.coerceAtMost(Int.MAX_VALUE.toLong()).toInt().coerceAtLeast(1)
            val next = input.read()
            if (next < 0) return null
            if (next !in 32..126 && next != 13 && next != 10) return null
            headers.append(next.toChar())
            if (headers.endsWith("\r\n\r\n")) return headers.toString().substringBefore("\r\n")
        }
        return null
    }

    private fun respond(socket: Socket, status: Int, body: String) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        runCatching {
            socket.getOutputStream().write(("HTTP/1.1 $status Result\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n").toByteArray(Charsets.US_ASCII) + bytes)
            socket.getOutputStream().flush()
        }
    }

    private fun randomSecret(): String = Base64.getUrlEncoder().withoutPadding()
        .encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) })
}
