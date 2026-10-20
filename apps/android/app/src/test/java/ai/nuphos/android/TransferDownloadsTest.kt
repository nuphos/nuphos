package ai.nuphos.android

import ai.nuphos.android.data.*
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.time.Instant

class TransferDownloadsTest {
    private val file = TransferDownloadFile("file", "../report.txt", "ready", "text/plain", "https://storage.example.test/file?signature=synthetic", 3)
    private fun repository(status: Int = 200, body: String = "abc", inspect: (Request) -> Unit = {}) = TransferDownloads(
        OkHttpClient.Builder().followRedirects(false).addInterceptor { chain ->
            inspect(chain.request())
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(status).message("synthetic")
                .body(body.toResponseBody()).build()
        }.build())

    @Test fun storageDownloadStreamsExactBytesWithoutApiCredentials() = runBlocking {
        val output = ByteArrayOutputStream()
        repository(inspect = { assertNull(it.header("Authorization")); assertNull(it.header("Cookie")) }).copy(file, output)
        assertEquals("abc", output.toString())
        assertEquals("report.txt", file.safeName)
    }

    @Test fun redirectsTruncationOversizeAndRevocationFail() = runBlocking {
        for (repo in listOf(repository(status = 302), repository(body = "ab"), repository(body = "abcd"))) {
            try { repo.copy(file, ByteArrayOutputStream()); fail("Must reject invalid download") } catch (_: java.io.IOException) { }
        }
        var requests = 0
        try { repository(inspect = { requests++ }).copy(file, ByteArrayOutputStream()) { false }; fail("Revoked") }
        catch (_: kotlinx.coroutines.CancellationException) { }
        assertEquals(0, requests)
        try { repository().copy(file.copy(size = TransferDownloads.MAX_BYTES + 1), ByteArrayOutputStream()); fail("Oversized") }
        catch (_: IllegalArgumentException) { }
    }

    @Test fun storageRejectsNonHttpsAndEmbeddedCredentials() {
        for (url in listOf("http://storage.example.test/a", "file:///private/file", "https://user:password@storage.example.test/a")) {
            try { TransferDownloads.request(file.copy(downloadUrl = url)); fail("Invalid storage URL") }
            catch (_: IllegalArgumentException) { }
        }
    }

    @Test fun metadataRejectsExpiredWrongGroupAndDuplicateFiles() {
        val now = Instant.parse("2026-10-18T00:00:00Z")
        val group = TransferDownloadGroup("group", "2026-10-19T00:00:00Z", listOf(file))
        assertEquals(listOf(file), group.readyFiles("group", now))
        for ((value, expected) in listOf(group to "other", group.copy(expiresAt = now.toString()) to "group", group.copy(files = listOf(file, file)) to "group")) {
            try { value.readyFiles(expected, now); fail("Invalid metadata") } catch (_: IllegalArgumentException) { }
        }
        assertTrue(file.copy(contentType = "image/jpeg").isImage)
        assertFalse(file.copy(contentType = "image/svg+xml").isImage)
    }
}
