package ai.nuphos.android.ui.chat

import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.MediaStore
import android.util.Base64
import android.util.Base64InputStream
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException

internal typealias ImageOriginalWriter = suspend (String, File) -> String

internal data class ExportedImage(val file: File, val mime: String, val name: String)

/** Only original bytes enter this directory; URLs, headers and decoded thumbnails never do. */
internal object ImageExports {
    private const val MAX_INLINE = 16 * 1024 * 1024
    private const val RETENTION = 24 * 60 * 60 * 1000L
    private val extensions = mapOf("image/png" to "png", "image/jpeg" to "jpg", "image/webp" to "webp", "image/gif" to "gif")

    suspend fun writeInline(source: String, destination: File): String = withContext(Dispatchers.IO) {
        require(source.length <= MAX_INLINE)
        val comma = source.indexOf(',')
        require(comma in 1..80 && Regex("data:image/(png|jpeg|jpg|webp|gif);base64", RegexOption.IGNORE_CASE).matches(source.substring(0, comma)))
        Base64InputStream(source.substring(comma + 1).byteInputStream(Charsets.US_ASCII), Base64.DEFAULT).use { input ->
            destination.outputStream().use { output -> input.copyTo(output) }
        }
        "image"
    }

    suspend fun prepare(context: Context, source: String, writer: ImageOriginalWriter): ExportedImage {
        var owned: File? = null
        try {
            val result = withContext(Dispatchers.IO) {
                val directory = File(context.cacheDir, "image-exports").apply { check(isDirectory || mkdirs()) }
                directory.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > RETENTION) it.delete() }
                check((directory.listFiles()?.size ?: 0) < 20) { "Too many pending exports" }
                val temporary = File.createTempFile("image-", ".tmp", directory)
                try {
                    val name = writer(source, temporary)
                    currentCoroutineContext().ensureActive()
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeFile(temporary.path, bounds)
                    val extension = extensions[bounds.outMimeType] ?: throw IOException("Unsupported image")
                    require(bounds.outWidth in 1..100_000 && bounds.outHeight in 1..100_000 &&
                        bounds.outWidth.toLong() * bounds.outHeight <= 50_000_000L && temporary.length() in 1..104_857_600L)
                    val stem = name.substringAfterLast('/').substringAfterLast('\\').substringBeforeLast('.')
                        .filter { it.isLetterOrDigit() || it in "-_ " }.trim().take(80).ifBlank { "image" }
                    val displayName = "$stem.$extension"
                    val ready = File(directory, "${temporary.nameWithoutExtension}-$displayName")
                    check(temporary.renameTo(ready))
                    owned = ready
                    ExportedImage(ready, bounds.outMimeType, displayName)
                } finally { temporary.delete() }
            }
            owned = null
            return result
        } finally { owned?.delete() }
    }

    fun shareIntent(context: Context, image: ExportedImage): Intent {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.imageexports", image.file)
        return Intent(Intent.ACTION_SEND).apply {
            type = image.mime
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = ClipData.newUri(context.contentResolver, image.name, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    private suspend fun copyOriginal(file: File, output: java.io.OutputStream) {
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                currentCoroutineContext().ensureActive()
                val count = input.read(buffer)
                if (count < 0) break
                output.write(buffer, 0, count)
            }
        }
    }

    suspend fun save(context: Context, image: ExportedImage,
        copy: suspend (File, java.io.OutputStream) -> Unit = ::copyOriginal,
    ): Uri = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val uri = requireNotNull(resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, image.name)
            put(MediaStore.Images.Media.MIME_TYPE, image.mime)
            put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Nuphos")
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }))
        try {
            requireNotNull(resolver.openOutputStream(uri, "w")).use { output ->
                copy(image.file, output)
            }
            currentCoroutineContext().ensureActive()
            check(resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null) == 1)
            uri
        } catch (error: Exception) {
            resolver.delete(uri, null, null)
            throw error
        }
    }
}
