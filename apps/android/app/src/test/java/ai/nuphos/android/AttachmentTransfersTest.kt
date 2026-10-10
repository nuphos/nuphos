package ai.nuphos.android

import ai.nuphos.android.data.AttachmentTransfers
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.ComposerAttachment
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class AttachmentTransfersTest {
    private val attachment = ComposerAttachment(name = "same.txt", kind = ComposerAttachment.Kind.File("marker".toByteArray(), "text/plain"))

    @Test fun signedRequestHasExactBytesMimeLengthAndNoAuthentication() {
        val bytes = "exact marker".toByteArray()
        val url = "https://storage.example/key?X-Signed=unchanged%2Fvalue"
        var written = 0L
        val request = AttachmentTransfers.storageRequest(url, "text/plain", bytes, {}) { written = it }
        assertEquals(url, request.url.toString())
        assertNull(request.header("Authorization"))
        assertNull(request.header("Cookie"))
        assertNull(request.header("x-atlas-client"))
        assertEquals(bytes.size.toLong(), request.body!!.contentLength())
        assertEquals("text/plain", request.body!!.contentType().toString())
        val buffer = okio.Buffer()
        request.body!!.writeTo(buffer)
        assertArrayEquals(bytes, buffer.readByteArray())
        assertEquals(bytes.size.toLong(), written)
    }

    @Test fun rejectsEmptyAndDuplicateIdentities() {
        assertThrows(IllegalArgumentException::class.java) { AttachmentTransfers().retain(emptyList()) }
        assertThrows(IllegalArgumentException::class.java) { AttachmentTransfers().retain(listOf(attachment, attachment)) }
    }

    @Test fun duplicateDisplayNamesHaveDistinctSafePathsAndImagesUseJpeg() {
        val image = ComposerAttachment(name = "../same.png", kind = ComposerAttachment.Kind.Image(byteArrayOf(1, 2, 3)))
        val helper = AttachmentTransfers()
        val pending = helper.retain(listOf(attachment, attachment.copy(id = "other"), image))
        assertEquals(3, pending.payloads.map { it.path }.toSet().size)
        assertEquals("same.txt", pending.payloads[1].name)
        assertFalse(pending.payloads[2].path.contains('/'))
        assertTrue(pending.payloads[2].path.endsWith(".jpg"))
        assertEquals("image/jpeg", pending.payloads[2].mime)
    }

    @Test fun partialRetryReconcilesSameGroupAndKeepsExactBytes() = runTest {
        val fixture = Fixture()
        val helper = AttachmentTransfers(fixture) { 0L }
        val pending = helper.retain(listOf(attachment))
        fixture.partial = true
        assertTrue(runCatching { helper.prepare("token", "team", pending) }.isFailure)
        fixture.partial = false
        val ready = helper.prepare("token", "team", pending)
        assertEquals(1, fixture.intents)
        assertEquals(1, fixture.puts)
        assertArrayEquals("marker".toByteArray(), fixture.bytes)
        assertTrue(ready.instruction.contains("transfer group ${fixture.group}"))
    }

    @Test fun mismatchedSizeAndCancellationBlockReady() = runTest {
        val fixture = Fixture()
        val helper = AttachmentTransfers(fixture) { 0L }
        val pending = helper.retain(listOf(attachment))
        fixture.size = 99
        assertTrue(runCatching { helper.prepare("token", "team", pending) }.isFailure)
        helper.cancel(pending)
        assertTrue(runCatching { helper.prepare("token", "team", pending) }.isFailure)
    }

    @Test fun missingIdentityAndLostPutResponseRetainGroup() = runTest {
        val fixture = Fixture()
        val helper = AttachmentTransfers(fixture) { 0L }
        val pending = helper.retain(listOf(attachment))
        fixture.losePut = true
        assertTrue(runCatching { helper.prepare("token", "team", pending) }.isFailure)
        fixture.losePut = false
        val ready = helper.prepare("token", "team", pending)
        assertEquals(fixture.group, ready.groupId)
        assertEquals(1, fixture.intents)
        assertEquals(1, fixture.puts)
        fixture.badIdentity = true
        assertTrue(runCatching { helper.prepare("token", "team", pending) }.isFailure)
    }

    @Test fun callbackCancellationStopsReadyReturn() = runTest {
        val fixture = Fixture()
        val helper = AttachmentTransfers(fixture) { 0L }
        val pending = helper.retain(listOf(attachment))
        assertTrue(runCatching {
            helper.prepare("token", "team", pending) { if (it.stage == AttachmentTransfers.Stage.Ready) helper.cancel(pending) }
        }.isFailure)
    }

    @Test fun revocationAfterIntentStopsStorageAndFinalize() = runTest {
        var allowed = true
        val fixture = Fixture().apply { afterIntent = { allowed = false } }
        val helper = AttachmentTransfers(fixture) { 0L }
        assertTrue(runCatching { helper.prepare("token", "team", helper.retain(listOf(attachment)), allowed = { allowed }) }.isFailure)
        assertEquals(1, fixture.intents)
        assertEquals(0, fixture.puts)
        assertEquals(0, fixture.finalizes)
    }

    @Test fun revocationAfterPutStopsFinalize() = runTest {
        var allowed = true
        val fixture = Fixture().apply { afterPut = { allowed = false } }
        val helper = AttachmentTransfers(fixture) { 0L }
        assertTrue(runCatching { helper.prepare("token", "team", helper.retain(listOf(attachment)), allowed = { allowed }) }.isFailure)
        assertEquals(1, fixture.puts)
        assertEquals(0, fixture.finalizes)
    }

    @Test fun deniedUploadMakesNoRequests() = runTest {
        val fixture = Fixture()
        val helper = AttachmentTransfers(fixture) { 0L }
        assertTrue(runCatching { helper.prepare("token", "team", helper.retain(listOf(attachment)), allowed = { false }) }.isFailure)
        assertEquals(0, fixture.intents)
        assertEquals(0, fixture.puts)
    }

    private class Fixture : AttachmentTransfers.Transport {
        val group = "0123456789abcdef01234567"
        var afterIntent: () -> Unit = {}
        var afterPut: () -> Unit = {}
        var finalizes = 0
        var intents = 0
        var puts = 0
        var bytes = byteArrayOf()
        var partial = false
        var losePut = false
        var badIdentity = false
        var size = 6
        override suspend fun api(method: String, path: String, token: String, body: JsonValue?): String {
            if (path.endsWith("file-transfers")) {
                intents++
                afterIntent()
                return """{"groupId":"$group","direction":"upload","status":"pending","expiresAt":"2099-01-01T00:00:00Z","files":[{"id":"file1","fileName":"same.txt","relPath":"1-same.txt","uploadUrl":"https://storage.example/signed?a=b","expiresAt":"2099-01-01T00:00:00Z"}]}"""
            }
            finalizes++
            return """{"groupId":"$group","direction":"upload","status":"${if (partial) "partial" else "ready"}","expiresAt":"2099-01-01T00:00:00Z","files":[{"id":"${if (badIdentity) "wrong" else "file1"}","fileName":"same.txt","relPath":"1-same.txt","status":"ready","size":$size}]}"""
        }
        override suspend fun put(url: String, mime: String, bytes: ByteArray, pending: AttachmentTransfers.Pending, progress: (Long) -> Unit) {
            assertEquals("text/plain", mime)
            puts++
            this.bytes = bytes.copyOf()
            progress(bytes.size.toLong())
            afterPut()
            if (losePut) throw java.io.IOException("PUT response lost")
        }
    }
}
