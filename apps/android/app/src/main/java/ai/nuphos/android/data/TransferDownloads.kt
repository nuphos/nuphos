package ai.nuphos.android.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.Serializable
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.IOException
import java.io.OutputStream
import java.time.Instant
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

@Serializable
data class TransferDownloadGroup(val groupId: String, val expiresAt: String, val files: List<TransferDownloadFile>) {
    fun readyFiles(expectedId: String, now: Instant = Instant.now()): List<TransferDownloadFile> {
        require(groupId == expectedId && Instant.parse(expiresAt).isAfter(now))
        require(files.size <= 20 && files.map { it.id }.distinct().size == files.size)
        require(files.all { it.id.isNotBlank() && it.fileName.isNotBlank() && it.fileName.length <= 512 })
        return files.filter { it.status == "ready" }
    }
}

@Serializable
data class TransferDownloadFile(
    val id: String,
    val fileName: String,
    val status: String,
    val contentType: String? = null,
    val downloadUrl: String? = null,
    val size: Long? = null,
) {
    val isImage: Boolean get() = if (contentType != null) contentType.lowercase() in setOf("image/png", "image/jpeg", "image/webp", "image/gif")
        else fileName.substringAfterLast('.', "").lowercase() in setOf("png", "jpg", "jpeg", "webp", "gif")
    val safeName: String get() = fileName.substringAfterLast('/').substringAfterLast('\\')
        .filter { !it.isISOControl() }.trim().take(200).takeUnless { it.isBlank() || it == "." || it == ".." } ?: "attachment"
}

/** Storage requests never use Http.client, bearer headers, cookies or redirects. */
class TransferDownloads(private val storage: Call.Factory = OkHttpClient.Builder()
    .followRedirects(false).followSslRedirects(false).build()) {
    companion object {
        const val MAX_BYTES = 104_857_600L
        suspend fun group(token: String, teamId: String, groupId: String): TransferDownloadGroup {
            require(teamId.matches(Regex("[a-fA-F0-9]{24}")) && groupId.matches(Regex("[a-fA-F0-9]{24}")))
            return Http.json.decodeFromString(AgentChatApi.send("GET", "teams/$teamId/file-transfers/$groupId/download", token))
        }
        internal fun request(file: TransferDownloadFile): Request {
            val url = file.downloadUrl?.toHttpUrlOrNull()
            require(url != null && url.scheme == "https" && url.username.isEmpty() && url.password.isEmpty())
            require(file.size == null || file.size in 0..MAX_BYTES)
            return Request.Builder().url(url).get().build()
        }
    }

    suspend fun copy(file: TransferDownloadFile, output: OutputStream, allowed: () -> Boolean = { true }) {
        if (!allowed()) throw CancellationException("Attachment access changed")
        val request = request(file)
        suspendCancellableCoroutine<Unit> { continuation ->
            val call = storage.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, error: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(IOException("Couldn't download the file. Try again."))
                }
                override fun onResponse(call: Call, response: Response) {
                    try {
                        response.use {
                            if (!it.isSuccessful) throw IOException("Attachment unavailable")
                            val body = it.body
                            if (body.contentLength() > MAX_BYTES) throw IOException("Attachment too large")
                            var count = 0L
                            body.byteStream().use { input ->
                                val buffer = ByteArray(8192)
                                while (true) {
                                    if (!continuation.isActive || !allowed()) throw CancellationException("Attachment access changed")
                                    val read = input.read(buffer)
                                    if (read < 0) break
                                    count += read
                                    if (count > MAX_BYTES || (file.size != null && count > file.size)) throw IOException("Attachment size changed")
                                    output.write(buffer, 0, read)
                                }
                            }
                            if (file.size != null && count != file.size) throw IOException("Attachment size changed")
                            if (!allowed()) throw CancellationException("Attachment access changed")
                        }
                        if (continuation.isActive) continuation.resume(Unit)
                    } catch (error: Exception) {
                        if (continuation.isActive) continuation.resumeWithException(
                            if (error is CancellationException) error else IOException("Couldn't download the file. Try again."))
                    }
                }
            })
        }
    }
}
