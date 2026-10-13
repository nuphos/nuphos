package ai.nuphos.android

import ai.nuphos.android.data.AttachmentRetention
import ai.nuphos.android.data.AttachmentTransfers
import ai.nuphos.android.model.ComposerAttachment
import java.io.ByteArrayInputStream
import java.io.File
import kotlinx.coroutines.CancellationException
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

class AttachmentRetentionTest {
    @Test fun declaredAggregateRejectsBeforeOpeningAnySource() = inDirectory { directory ->
        var opened = 0
        val retention = AttachmentRetention(directory, maxFileBytes = 10, maxTotalBytes = 15)
        val sources = List(2) { AttachmentRetention.Input("$it.txt", "text/plain", 10) { opened++; ByteArrayInputStream(ByteArray(10)) } }
        assertThrows(IllegalArgumentException::class.java) { retention.retain(emptyList(), sources) }
        assertEquals(0, opened)
        assertEquals(0, directory.listFiles()!!.size)
    }

    @Test fun unknownSizesStopAtRemainingBudgetAndRemoveOnlyNewCopies() = inDirectory { directory ->
        val retention = AttachmentRetention(directory, maxFileBytes = 10, maxTotalBytes = 15)
        val old = retention.retain(emptyList(), listOf(input("old", 5))).single()
        var reads = 0
        val tooLarge = AttachmentRetention.Input("unknown", "text/plain", null) {
            object : java.io.InputStream() {
                override fun read(): Int { reads++; return 65 }
                override fun read(bytes: ByteArray, offset: Int, length: Int): Int { reads += length; bytes.fill(65, offset, offset + length); return length }
            }
        }
        assertThrows(IllegalArgumentException::class.java) { retention.retain(listOf(old), listOf(input("new", 4), tooLarge)) }
        assertTrue(reads <= 7)
        assertEquals(1, directory.listFiles()!!.size)
        assertEquals(5L, old.sizeBytes)
        old.releaseOwnedCopy()
        assertEquals(0, directory.listFiles()!!.size)
    }

    @Test fun ownedCopySurvivesOriginalSourceLossAndStreamsWithoutAuth() = inDirectory { directory ->
        val original = File(directory, "external-original").apply { writeBytes(ByteArray(25_000) { (it % 101).toByte() }) }
        val expected = original.readBytes()
        val retention = AttachmentRetention(File(directory, "owned"))
        val attachment = retention.retain(emptyList(), listOf(AttachmentRetention.Input("document.txt", "text/plain", original.length()) { original.inputStream() })).single()
        original.delete()
        val kind = attachment.kind as ComposerAttachment.Kind.RetainedFile
        val chunks = mutableListOf<Long>()
        val request = AttachmentTransfers.storageRequest("https://storage.example/x?signature=exact%2Fvalue", "text/plain", kind.source, {}) { chunks += it }
        assertNull(request.header("Authorization"))
        assertNull(request.header("Cookie"))
        assertEquals(25_000L, request.body!!.contentLength())
        val buffer = Buffer()
        request.body!!.writeTo(buffer)
        assertArrayEquals(expected, buffer.readByteArray())
        assertEquals(listOf(8192L, 16384L, 24576L, 25000L), chunks)
        val repeated = Buffer()
        request.body!!.writeTo(repeated)
        assertArrayEquals(expected, repeated.readByteArray())
        attachment.releaseOwnedCopy()
        assertFalse(kind.source.exists)
        assertThrows(java.io.IOException::class.java) { request.body!!.writeTo(Buffer()) }
    }

    @Test fun streamCancellationDoesNotDeleteRetainedCopy() = inDirectory { directory ->
        val attachment = AttachmentRetention(directory).retain(emptyList(), listOf(input("file", 25_000))).single()
        val source = (attachment.kind as ComposerAttachment.Kind.RetainedFile).source
        var checks = 0
        val request = AttachmentTransfers.storageRequest("https://storage.example/x", "text/plain", source, { if (++checks == 2) throw CancellationException("cancel") }, {})
        val output = Buffer()
        assertThrows(java.io.IOException::class.java) { request.body!!.writeTo(output) }
        assertEquals(8192L, output.size)
        assertTrue(source.exists)
        attachment.releaseOwnedCopy()
    }

    @Test fun cancellationDuringCopyRemovesOnlyNewCopies() = inDirectory { directory ->
        val retention = AttachmentRetention(directory)
        val existing = retention.retain(emptyList(), listOf(input("old", 5))).single()
        var checks = 0
        assertThrows(CancellationException::class.java) {
            retention.retain(listOf(existing), listOf(input("new", 25_000)), check = { if (++checks == 3) throw CancellationException("cancel") })
        }
        assertEquals(1, directory.listFiles()!!.size)
        assertTrue((existing.kind as ComposerAttachment.Kind.RetainedFile).source.exists)
        existing.releaseOwnedCopy()
    }

    @Test fun explicitReleaseNeverDeletesSelectedOriginal() = inDirectory { directory ->
        val original = File(directory, "external-original").apply { writeText("marker") }
        val attachment = AttachmentRetention(File(directory, "owned")).retain(emptyList(), listOf(AttachmentRetention.Input("document", "text/plain", original.length()) { original.inputStream() })).single()
        attachment.releaseOwnedCopy()
        attachment.releaseOwnedCopy()
        assertTrue(original.exists())
        assertEquals("marker", original.readText())
        assertFalse((attachment.kind as ComposerAttachment.Kind.RetainedFile).source.exists)
    }

    @Test fun convertedImageUsesRemainingAggregateBudget() = inDirectory { directory ->
        val retention = AttachmentRetention(directory, maxFileBytes = 10, maxTotalBytes = 15)
        val old = retention.retain(emptyList(), listOf(input("old", 9))).single()
        var remaining = 0L
        val image = AttachmentRetention.Input("photo", "image/jpeg", 10, isImage = true) { error("The fixture image preparer should be used.") }
        assertThrows(IllegalArgumentException::class.java) {
            retention.retain(listOf(old), listOf(image), prepareImage = { _, budget ->
                remaining = budget
                ComposerAttachment(name = "photo.jpg", kind = ComposerAttachment.Kind.Image(ByteArray(7)))
            })
        }
        assertEquals(6L, remaining)
        assertTrue((old.kind as ComposerAttachment.Kind.RetainedFile).source.exists)
        old.releaseOwnedCopy()
    }

    private fun input(name: String, size: Int) = AttachmentRetention.Input(name, "text/plain", size.toLong()) { ByteArrayInputStream(ByteArray(size) { 65 }) }
    private fun inDirectory(block: (File) -> Unit) {
        val directory = java.nio.file.Files.createTempDirectory("attachment-retention-test").toFile()
        try { block(directory) } finally { directory.deleteRecursively() }
    }
}
