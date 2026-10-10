package ai.nuphos.android.data

import ai.nuphos.android.model.ComposerAttachment
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.atomic.AtomicBoolean

/** The only deletable file is the app-created copy, never its selected source. */
class OwnedAttachmentFile private constructor(private val file: File, val size: Long) {
    private val released = AtomicBoolean(false)
    val exists: Boolean get() = !released.get() && file.isFile
    internal fun open(): InputStream {
        if (!exists || file.length() != size) throw IOException("The retained attachment is unavailable or changed.")
        return file.inputStream()
    }
    fun release() {
        if (released.compareAndSet(false, true)) file.delete()
    }

    internal companion object {
        fun copy(directory: File, input: InputStream, limit: Long, check: () -> Unit): OwnedAttachmentFile {
            require(limit > 0) { "Attachment batch exceeds its size limit." }
            require(directory.isDirectory || directory.mkdirs()) { "Could not retain the selected file." }
            val file = File.createTempFile("attachment-", ".upload", directory)
            try {
                var size = 0L
                file.outputStream().use { output ->
                    val buffer = ByteArray(8192)
                    while (true) {
                        check()
                        // Read one extra byte to reject oversize input before writing it.
                        val count = input.read(buffer, 0, minOf(buffer.size.toLong(), limit - size + 1).toInt())
                        if (count < 0) break
                        if (count == 0) continue
                        require(size + count <= limit) { "The selected file exceeds the remaining attachment size limit." }
                        output.write(buffer, 0, count)
                        size += count
                    }
                }
                require(size > 0) { "The selected file is empty." }
                check()
                return OwnedAttachmentFile(file, size)
            } catch (failure: Throwable) {
                file.delete()
                throw failure
            }
        }
    }
}

/** Validates selection metadata first, then retains each source with a bounded buffer. */
class AttachmentRetention(
    private val directory: File,
    private val maxFileBytes: Long = AttachmentTransfers.MAX_FILE_BYTES,
    private val maxTotalBytes: Long = AttachmentTransfers.MAX_TOTAL_BYTES,
) {
    data class Input(
        val name: String,
        val mime: String,
        val declaredSize: Long?,
        val isImage: Boolean = false,
        val open: () -> InputStream,
    )

    fun retain(
        existing: List<ComposerAttachment>,
        inputs: List<Input>,
        check: () -> Unit = {},
        prepareImage: ((Input, Long) -> ComposerAttachment)? = null,
    ): List<ComposerAttachment> {
        require(existing.size + inputs.size in 1..AttachmentTransfers.MAX_FILES) { "Select at most 20 files." }
        require(existing.all { it.sizeBytes in 1..maxFileBytes }) { "An attachment exceeds the file size limit." }
        var total = existing.sumOf { it.sizeBytes }
        require(total <= maxTotalBytes) { "Attachment batch exceeds its size limit." }
        inputs.forEach { input ->
            require(input.name.trim().length in 1..512) { "Attachment filename must have 1 to 512 characters." }
            input.declaredSize?.let { require(it in 1..maxFileBytes) { "The selected file is empty or exceeds the file size limit." } }
        }
        // Image output is the converted JPEG, so only document sizes are added here.
        val declaredDocuments = inputs.filter { !it.isImage }.sumOf { it.declaredSize ?: 0L }
        require(declaredDocuments <= maxTotalBytes - total) { "Attachment batch exceeds its size limit." }
        val loaded = mutableListOf<ComposerAttachment>()
        try {
            for (input in inputs) {
                check()
                val remaining = minOf(maxFileBytes, maxTotalBytes - total)
                require(remaining > 0) { "Attachment batch exceeds its size limit." }
                val attachment = if (input.isImage) {
                    requireNotNull(prepareImage) { "An image preparer is required." }(input, remaining)
                } else {
                    val source = input.open().use { OwnedAttachmentFile.copy(directory, it, remaining, check) }
                    ComposerAttachment(name = input.name, kind = ComposerAttachment.Kind.RetainedFile(source, input.mime))
                }
                loaded += attachment
                require(attachment.sizeBytes in 1..remaining) { "The prepared attachment exceeds the remaining size limit." }
                total += attachment.sizeBytes
            }
            check()
            return loaded
        } catch (failure: Throwable) {
            loaded.forEach { it.releaseOwnedCopy() }
            throw failure
        }
    }
}
