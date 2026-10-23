package ai.nuphos.android

import android.content.Intent
import android.graphics.Bitmap
import android.provider.MediaStore
import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.ui.chat.ImageExports
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.launch
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.security.MessageDigest

/** Independent synthetic package only. Does not launch a receiver or read account state. */
class ImageExportsFixtureDeviceTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun isolated() = assumeTrue(context.packageName.endsWith(".imageexport1336"))
    private fun bytes(): ByteArray {
        val bitmap = Bitmap.createBitmap(32, 24, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(android.graphics.Color.CYAN)
        return ByteArrayOutputStream().also {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            bitmap.recycle()
        }.toByteArray()
    }
    private fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).toList()

    @Test fun savesOriginalBytesAndMimeAndSharesOnlyReadOnlyContentUri() = runBlocking {
        isolated()
        val original = bytes()
        // Deliberately wrong data MIME: exported MIME must come from actual bytes.
        val image = ImageExports.prepare(context, "data:image/jpeg;base64," + Base64.encodeToString(original, Base64.NO_WRAP), ImageExports::writeInline)
        var saved: android.net.Uri? = null
        try {
            assertEquals("image/png", image.mime)
            assertTrue(image.name.endsWith(".png"))
            assertEquals(hash(original), hash(image.file.readBytes()))
            val share = ImageExports.shareIntent(context, image)
            assertEquals(Intent.ACTION_SEND, share.action)
            assertEquals("image/png", share.type)
            assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION, share.flags)
            assertNull(share.getStringExtra(Intent.EXTRA_TEXT))
            val uri = share.getParcelableExtra(Intent.EXTRA_STREAM, android.net.Uri::class.java)!!
            assertEquals("content", uri.scheme)
            assertEquals("${context.packageName}.imageexports", uri.authority)
            assertEquals(uri, share.clipData!!.getItemAt(0).uri)
            assertEquals(hash(original), hash(context.contentResolver.openInputStream(uri)!!.use { it.readBytes() }))
            val savedUri = ImageExports.save(context, image)
            saved = savedUri
            assertEquals(hash(original), hash(context.contentResolver.openInputStream(savedUri)!!.use { it.readBytes() }))
            context.contentResolver.query(savedUri, arrayOf(MediaStore.Images.Media.MIME_TYPE, MediaStore.Images.Media.IS_PENDING), null, null, null)!!.use {
                assertTrue(it.moveToFirst())
                assertEquals("image/png", it.getString(0))
                assertEquals(0, it.getInt(1))
            }
            assertTrue(image.file.setLastModified(System.currentTimeMillis() - 25 * 60 * 60 * 1000L))
            var expired = false
            try { context.contentResolver.openInputStream(uri)?.close() }
            catch (_: java.io.FileNotFoundException) { expired = true }
            assertTrue(expired)
        } finally {
            saved?.let { context.contentResolver.delete(it, null, null) }
            image.file.delete()
        }
    }

    @Test fun rejectsUrlsMalformedBytesAndFailedDownloadsWithoutPublishing() = runBlocking {
        isolated()
        for (source in listOf("https://example.invalid/private.png?secret=synthetic", "data:image/png;base64,%%%%", "data:image/png;base64,YWJj")) {
            var failed = false
            try { ImageExports.prepare(context, source, ImageExports::writeInline) }
            catch (_: Exception) { failed = true }
            assertTrue(failed)
        }
        var failed = false
        try { ImageExports.prepare(context, "synthetic-transfer-id") { _, file ->
            file.writeBytes(bytes())
            throw java.io.IOException("expired")
        } } catch (_: Exception) { failed = true }
        assertTrue(failed)
        assertTrue(java.io.File(context.cacheDir, "image-exports").listFiles().orEmpty().none { it.extension == "tmp" })
    }
    @Test fun failedMediaStoreWriteRemovesPendingEntryAndCancellationRemovesTemp() = runBlocking {
        isolated()
        val token = "synthetic-${java.util.UUID.randomUUID()}"
        val image = ImageExports.prepare(context, token) { _, file -> file.writeBytes(bytes()); token }
        fun entries(): Int = context.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI, arrayOf(MediaStore.Images.Media._ID),
            "${MediaStore.Images.Media.DISPLAY_NAME} = ?", arrayOf(image.name), null,
        )!!.use { it.count }
        val before = entries()
        image.file.delete()
        var failed = false
        try { ImageExports.save(context, image) }
        catch (_: Exception) { failed = true }
        assertTrue(failed)
        assertEquals(before, entries())
        var cancelled = false
        try { ImageExports.prepare(context, token) { _, file ->
            file.writeBytes(bytes())
            throw kotlinx.coroutines.CancellationException("synthetic cancellation")
        } } catch (_: kotlinx.coroutines.CancellationException) { cancelled = true }
        assertTrue(cancelled)
        assertTrue(java.io.File(context.cacheDir, "image-exports").listFiles().orEmpty().none { it.extension == "tmp" })
    }

    @Test fun partialWriteCancellationAndIoFailureLeaveNoMediaStoreRows() = runBlocking {
        isolated()
        val token = "synthetic-${java.util.UUID.randomUUID()}"
        val image = ImageExports.prepare(context, token) { _, file -> file.writeBytes(bytes()); token }
        fun entries(): Int = context.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI, arrayOf(MediaStore.Images.Media._ID),
            "${MediaStore.Images.Media.DISPLAY_NAME} = ?", arrayOf(image.name), null,
        )!!.use { it.count }
        try {
            for (cancel in listOf(false, true)) {
                var failed = false
                try { ImageExports.save(context, image) { _, output ->
                    output.write(byteArrayOf(1, 2, 3))
                    output.flush()
                    if (cancel) throw kotlinx.coroutines.CancellationException("synthetic cancellation")
                    throw java.io.IOException("synthetic I/O failure")
                } } catch (error: Exception) {
                    failed = true
                    assertEquals(cancel, error is kotlinx.coroutines.CancellationException)
                }
                assertTrue(failed)
                assertEquals(0, entries())
            }
        } finally { image.file.delete() }
    }

    @Test fun duplicateNamesPreserveBothImagesAndDoNotTrustWriterFilename() = runBlocking {
        isolated()
        val original = bytes()
        val name = "synthetic-${java.util.UUID.randomUUID()}"
        val image = ImageExports.prepare(context, name) { _, file ->
            file.writeBytes(original)
            "../../$name.jpeg"
        }
        val saved = mutableListOf<android.net.Uri>()
        try {
            assertEquals("$name.png", image.name)
            repeat(2) { saved += ImageExports.save(context, image) }
            assertNotEquals(saved[0], saved[1])
            saved.forEach { uri ->
                assertEquals(hash(original), hash(context.contentResolver.openInputStream(uri)!!.use { it.readBytes() }))
            }
            val provider = context.packageManager.resolveContentProvider("${context.packageName}.imageexports", 0)!!
            assertFalse(provider.exported)
            assertTrue(provider.grantUriPermissions)
            val share = ImageExports.shareIntent(context, image)
            assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION, share.flags)
            assertNull(share.selector)
            assertEquals(setOf(Intent.EXTRA_STREAM), share.extras!!.keySet())
            val uri = share.getParcelableExtra(Intent.EXTRA_STREAM, android.net.Uri::class.java)!!
            var denied = false
            try { context.contentResolver.openFileDescriptor(uri, "w")?.close() }
            catch (_: java.io.FileNotFoundException) { denied = true }
            assertTrue(denied)
            val privateFile = java.io.File(context.filesDir, "synthetic-private-${java.util.UUID.randomUUID()}")
            try {
                privateFile.writeText("synthetic")
                var refused = false
                try { androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.imageexports", privateFile) }
                catch (_: IllegalArgumentException) { refused = true }
                assertTrue(refused)
            } finally { privateFile.delete() }
        } finally {
            saved.forEach { context.contentResolver.delete(it, null, null) }
            image.file.delete()
        }
    }

    @Test fun cancellationAfterIoRenameBeforeCallerDeliveryDeletesOwnedExport() = runBlocking {
        isolated()
        val queue = java.util.concurrent.LinkedBlockingQueue<Runnable>()
        val caller = object : kotlinx.coroutines.CoroutineDispatcher() {
            override fun dispatch(context: kotlin.coroutines.CoroutineContext, block: Runnable) { queue.add(block) }
        }
        val directory = java.io.File(context.cacheDir, "image-exports").apply { mkdirs() }
        val before = directory.listFiles().orEmpty().map { it.name }.toSet()
        val parent = kotlinx.coroutines.SupervisorJob()
        val scope = kotlinx.coroutines.CoroutineScope(parent + caller)
        try {
            repeat(25) {
                val job = scope.launch {
                    ImageExports.prepare(context, "synthetic") { _, file -> file.writeBytes(bytes()); "synthetic" }
                    fail("A cancelled caller must never receive the export")
                }
                requireNotNull(queue.poll(10, java.util.concurrent.TimeUnit.SECONDS)).run()
                val delivery = requireNotNull(queue.poll(10, java.util.concurrent.TimeUnit.SECONDS))
                val created = directory.listFiles().orEmpty().filter { it.name !in before }
                assertEquals(1, created.size)
                assertEquals("png", created.single().extension)
                job.cancel()
                delivery.run()
                job.join()
                assertEquals(before, directory.listFiles().orEmpty().map { it.name }.toSet())
            }
            val delivered = ImageExports.prepare(context, "synthetic") { _, file -> file.writeBytes(bytes()); "synthetic" }
            try { assertTrue(delivered.file.isFile) } finally { delivered.file.delete() }
            assertEquals(before, directory.listFiles().orEmpty().map { it.name }.toSet())
        } finally {
            parent.cancel()
            while (true) (queue.poll() ?: break).run()
            directory.listFiles().orEmpty().filter { it.name !in before }.forEach { it.delete() }
        }
    }

}
