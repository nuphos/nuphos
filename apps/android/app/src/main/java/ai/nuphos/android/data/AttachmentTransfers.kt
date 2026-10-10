package ai.nuphos.android.data

import ai.nuphos.android.model.ComposerAttachment
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Callback
import okhttp3.Response
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.serialization.Serializable
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import java.time.Instant
import java.util.concurrent.atomic.AtomicBoolean

/** Retains a single upload batch. The session owns chat dispatch and explicit retry. */
class AttachmentTransfers(
    private val transport: Transport = NetworkTransport,
    private val now: () -> Long = System::currentTimeMillis,
) {
    companion object {
        const val MAX_FILES = 20
        const val MAX_FILE_BYTES = 104_857_600L
        const val MAX_TOTAL_BYTES = 524_288_000L
        internal fun storageRequest(url: String, mime: String, bytes: ByteArray, check: () -> Unit, progress: (Long) -> Unit): Request {
            val body = object : RequestBody() {
                override fun contentType() = mime.toMediaType()
                override fun contentLength() = bytes.size.toLong()
                override fun writeTo(sink: BufferedSink) {
                    var written = 0
                    while (written < bytes.size) {
                        try { check() } catch (cancelled: CancellationException) { throw IOException("Attachment upload cancelled", cancelled) }
                        val count = minOf(8192, bytes.size - written)
                        sink.write(bytes, written, count)
                        written += count
                        try { progress(written.toLong()) } catch (cancelled: CancellationException) { throw IOException("Attachment upload cancelled", cancelled) }
                    }
                }
            }
            return Request.Builder().url(url).put(body).build()
        }
        internal fun storageRequest(url: String, mime: String, source: OwnedAttachmentFile, check: () -> Unit, progress: (Long) -> Unit): Request {
            val body = object : RequestBody() {
                override fun contentType() = mime.toMediaType()
                override fun contentLength() = source.size
                override fun writeTo(sink: BufferedSink) {
                    source.open().use { input ->
                        val buffer = ByteArray(8192)
                        var written = 0L
                        while (written < source.size) {
                            try { check() } catch (cancelled: CancellationException) { throw IOException("Attachment upload cancelled", cancelled) }
                            val count = input.read(buffer, 0, minOf(buffer.size.toLong(), source.size - written).toInt())
                            if (count < 0) throw IOException("The retained attachment size changed.")
                            if (count == 0) continue
                            sink.write(buffer, 0, count)
                            written += count
                            try { progress(written) } catch (cancelled: CancellationException) { throw IOException("Attachment upload cancelled", cancelled) }
                        }
                        try { check() } catch (cancelled: CancellationException) { throw IOException("Attachment upload cancelled", cancelled) }
                        if (input.read() != -1) throw IOException("The retained attachment size changed.")
                    }
                }
            }
            return Request.Builder().url(url).put(body).build()
        }
    }

    enum class Stage { Intent, Uploading, Finalizing, Ready }
    data class Progress(val stage: Stage, val attachmentId: String? = null, val bytesWritten: Long = 0, val totalBytes: Long = 0)
    data class Ready(val groupId: String, val instruction: String)
    class Failure(message: String) : Exception(message)

    internal data class Payload(val id: String, val name: String, val path: String, val mime: String, val bytes: ByteArray?, val source: OwnedAttachmentFile?) {
        val size: Long get() = source?.size ?: requireNotNull(bytes).size.toLong()
    }
    class Pending internal constructor(internal val payloads: List<Payload>) {
        internal var intent: Intent? = null
        internal val active = AtomicBoolean(false)
        internal val cancelled = AtomicBoolean(false)
        @Volatile internal var call: Call? = null
        val groupId: String? get() = intent?.groupId
        val attachmentIds: List<String> get() = payloads.map { it.id }
        @Volatile internal var allowed: () -> Boolean = { true }
        internal fun check() { if (!allowed() || cancelled.get()) throw CancellationException("Attachment upload cancelled") }
    }

    interface Transport {
        suspend fun api(method: String, path: String, token: String, body: JsonValue? = null): String
        suspend fun put(url: String, mime: String, bytes: ByteArray, pending: Pending, progress: (Long) -> Unit)
        suspend fun put(url: String, mime: String, source: OwnedAttachmentFile, pending: Pending, progress: (Long) -> Unit) {
            throw Failure("This transport does not support retained files.")
        }
    }

    fun retain(attachments: List<ComposerAttachment>): Pending {
        require(attachments.size in 1..MAX_FILES) { "Select 1 to $MAX_FILES attachments." }
        require(attachments.map { it.id }.toSet().size == attachments.size) { "Attachment identities must be unique." }
        val payloads = attachments.mapIndexed { index, attachment ->
            val name = attachment.name.trim()
            require(name.length in 1..512) { "Attachment filename must have 1 to 512 characters." }
            val bytes = when (val kind = attachment.kind) {
                is ComposerAttachment.Kind.Image -> kind.jpeg
                is ComposerAttachment.Kind.File -> kind.bytes
                is ComposerAttachment.Kind.RetainedFile -> null
            }
            val source = (attachment.kind as? ComposerAttachment.Kind.RetainedFile)?.source
            val mime = when (val kind = attachment.kind) {
                is ComposerAttachment.Kind.Image -> "image/jpeg"
                is ComposerAttachment.Kind.File -> kind.mime
                is ComposerAttachment.Kind.RetainedFile -> kind.mime
            }.trim().ifEmpty { "application/octet-stream" }
            require(attachment.sizeBytes in 1..MAX_FILE_BYTES) { "$name must contain 1 to $MAX_FILE_BYTES bytes." }
            require(mime.length in 1..255 && '\r' !in mime && '\n' !in mime) { "Invalid attachment MIME type." }
            val safeName = name.map { if (it.isLetterOrDigit() && it.code < 128 || it in "._-") it else '_' }.joinToString("")
                .trim('.').ifEmpty { "attachment" }
            val path = "${index + 1}-" + if (attachment.isImage) safeName.substringBeforeLast('.', safeName) + ".jpg" else safeName
            Payload(attachment.id, name, path, mime, bytes, source)
        }
        require(payloads.sumOf { it.size } <= MAX_TOTAL_BYTES) { "Attachment batch exceeds 500 MiB." }
        return Pending(payloads)
    }

    fun cancel(pending: Pending) {
        pending.cancelled.set(true)
        pending.call?.cancel()
    }

    suspend fun prepare(token: String, teamId: String, pending: Pending, allowed: () -> Boolean = { true }, onProgress: (Progress) -> Unit = {}): Ready {
        if (!allowed()) throw CancellationException("AI consent is required")
        require(teamId.matches(Regex("[A-Za-z0-9_-]+"))) { "Invalid team identity." }
        check(pending.active.compareAndSet(false, true)) { "This attachment batch is already uploading." }
        pending.allowed = allowed
        try {
            pending.check()
            currentCoroutineContext().ensureActive()
            val base = "teams/$teamId/file-transfers"
            var intent = pending.intent
            var readyIds = emptySet<String>()
            if (intent != null) {
                val existing = try {
                    onProgress(Progress(Stage.Finalizing))
                    pending.check()
                    val status = view(transport.api("GET", "$base/${intent.groupId}", token))
                    pending.check()
                    if (status.status == "ready") status
                    else view(transport.api("POST", "$base/${intent.groupId}/finalize", token))
                } catch (failure: AgentChatApi.Conflict.Other) {
                    if (failure.status == 410) null else throw failure
                }
                pending.check()
                if (existing != null) {
                    readyIds = validateView(existing, intent, pending)
                    if (existing.status == "ready" && readyIds.size == pending.payloads.size) return ready(intent, pending, onProgress)
                }
                if (existing == null || expiry(intent.expiresAt) <= now() || intent.files.any { it.id !in readyIds && expiry(it.expiresAt) <= now() }) {
                    intent = null
                    readyIds = emptySet()
                }
            }
            if (intent == null) {
                onProgress(Progress(Stage.Intent))
                val body = JsonValue.obj("direction" to JsonValue.Str("upload"), "files" to JsonValue.Arr(pending.payloads.map {
                    JsonValue.obj("fileName" to JsonValue.Str(it.name), "relPath" to JsonValue.Str(it.path), "size" to JsonValue.Number(it.size.toDouble()), "contentType" to JsonValue.Str(it.mime))
                }))
                pending.check()
                intent = Http.json.decodeFromString<Intent>(transport.api("POST", base, token, body))
                pending.check()
                validateIntent(intent, pending)
                pending.intent = intent
            }
            pending.check()
            intent.files.forEach { file ->
                if (file.id !in readyIds) {
                    val payload = pending.payloads.single { it.path == file.relPath }
                    pending.check()
                    val report: (Long) -> Unit = { written ->
                        pending.check()
                        onProgress(Progress(Stage.Uploading, payload.id, written, payload.size))
                    }
                    if (payload.source != null) transport.put(file.uploadUrl, payload.mime, payload.source, pending, report)
                    else transport.put(file.uploadUrl, payload.mime, requireNotNull(payload.bytes), pending, report)
                }
            }
            pending.check()
            onProgress(Progress(Stage.Finalizing))
            pending.check()
            val completed = view(transport.api("POST", "$base/${intent.groupId}/finalize", token))
            pending.check()
            val completedIds = validateView(completed, intent, pending)
            if (completed.status != "ready" || completedIds.size != pending.payloads.size) throw Failure("Some attachments are not ready. Retry the retained batch.")
            return ready(intent, pending, onProgress)
        } finally {
            pending.call = null
            pending.active.set(false)
        }
    }

    private fun ready(intent: Intent, pending: Pending, progress: (Progress) -> Unit): Ready {
        pending.check()
        if (expiry(intent.expiresAt) <= now()) throw Failure("Attachment transfer expired. Retry the retained batch.")
        progress(Progress(Stage.Ready))
        pending.check()
        val names = pending.payloads.joinToString(", ") { it.name.replace('\n', ' ').replace('\r', ' ') }
        val instruction = "[The user uploaded ${pending.payloads.size} file(s) to the Nuphos file-transfer store (transfer group ${intent.groupId}): $names. To work with them, load the file-transfer skill and pull them into the sandbox: bash skills/file-transfer/scripts/transfer-pull.sh \"\$TEAM\" ${intent.groupId} ./uploads]" +
            if (pending.payloads.any { it.mime == "image/jpeg" }) " Open and read the pulled image files before answering image questions." else ""
        return Ready(intent.groupId, instruction)
    }

    private fun validateIntent(intent: Intent, pending: Pending) {
        if (!intent.groupId.matches(Regex("[a-fA-F0-9]{24}")) || intent.direction != "upload" || intent.status != "pending" || expiry(intent.expiresAt) <= now()) throw Failure("Invalid upload intent.")
        if (intent.files.size != pending.payloads.size || intent.files.map { it.id }.toSet().size != intent.files.size || intent.files.map { it.relPath }.toSet() != pending.payloads.map { it.path }.toSet()) throw Failure("Upload intent does not match selected attachments.")
        intent.files.forEach { file ->
            val payload = pending.payloads.single { it.path == file.relPath }
            if (file.id.isBlank() || file.fileName != payload.name || !file.uploadUrl.startsWith("https://") || expiry(file.expiresAt) <= now()) throw Failure("Invalid attachment upload identity or URL.")
        }
    }

    private fun validateView(view: View, intent: Intent, pending: Pending): Set<String> {
        if (view.groupId != intent.groupId || view.direction != "upload" || view.status !in setOf("pending", "ready", "partial", "failed") || expiry(view.expiresAt) <= now() || view.files.size != intent.files.size || view.files.map { it.id }.toSet() != intent.files.map { it.id }.toSet() || view.files.map { it.id }.distinct().size != view.files.size) throw Failure("Transfer readback does not match the selected batch.")
        return view.files.mapNotNull { file ->
            val expected = intent.files.single { it.id == file.id }
            val payload = pending.payloads.single { it.path == expected.relPath }
            if (file.status !in setOf("pending", "ready", "failed") || file.relPath != expected.relPath || file.fileName != payload.name) throw Failure("Transfer file identity changed.")
            if (file.status == "ready") {
                if (file.size != payload.size) throw Failure("Transfer size does not match selected bytes.")
                file.id
            } else null
        }.toSet()
    }

    private fun view(text: String) = Http.json.decodeFromString<View>(text)
    private fun expiry(value: String): Long = try { Instant.parse(value).toEpochMilli() } catch (_: Exception) { throw Failure("Invalid transfer expiry.") }

    @Serializable internal data class Intent(val groupId: String, val direction: String, val status: String, val expiresAt: String, val files: List<IntentFile>)
    @Serializable internal data class IntentFile(val id: String, val fileName: String, val relPath: String, val uploadUrl: String, val expiresAt: String)
    @Serializable private data class View(val groupId: String, val direction: String, val status: String, val expiresAt: String, val files: List<ViewFile>)
    @Serializable private data class ViewFile(val id: String, val fileName: String, val relPath: String, val status: String, val size: Long? = null)


    private object NetworkTransport : Transport {
        // A separate client prevents API authentication, cookies, or redirects reaching storage.
        private val storage = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).build()
        override suspend fun api(method: String, path: String, token: String, body: JsonValue?): String {
            currentCoroutineContext().ensureActive()
            return AgentChatApi.send(method, path, token, body = body).also { currentCoroutineContext().ensureActive() }
        }
        override suspend fun put(url: String, mime: String, bytes: ByteArray, pending: Pending, progress: (Long) -> Unit) = withContext(Dispatchers.IO) {
            val context = currentCoroutineContext()
            upload(storageRequest(url, mime, bytes, { pending.check(); context.ensureActive() }, progress), pending)
        }
        override suspend fun put(url: String, mime: String, source: OwnedAttachmentFile, pending: Pending, progress: (Long) -> Unit) = withContext(Dispatchers.IO) {
            val context = currentCoroutineContext()
            upload(storageRequest(url, mime, source, { pending.check(); context.ensureActive() }, progress), pending)
        }
        private suspend fun upload(request: Request, pending: Pending) {
            val context = currentCoroutineContext()
            val call = storage.newCall(request)
            pending.call = call
            pending.check()
            try {
                suspendCancellableCoroutine<Unit> { continuation ->
                    continuation.invokeOnCancellation { call.cancel() }
                    call.enqueue(object : Callback {
                        override fun onFailure(call: Call, error: IOException) {
                            if (continuation.isActive) continuation.resumeWithException(error)
                        }
                        override fun onResponse(call: Call, response: Response) {
                            response.use {
                                if (continuation.isActive) {
                                    if (it.isSuccessful) continuation.resume(Unit)
                                    else continuation.resumeWithException(Failure("Storage upload failed (${it.code}). Retry the retained batch."))
                                }
                            }
                        }
                    })
                }
                context.ensureActive()
                pending.check()
            } finally { pending.call = null }
        }
    }
}
