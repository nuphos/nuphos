package ai.nuphos.android

import ai.nuphos.android.data.Http
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.model.SessionResource
import ai.nuphos.android.model.SessionResourcesEnvelope
import ai.nuphos.android.session.SessionResourcesStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.Assert.*
import org.junit.Test

class SessionResourcesTest {
    private val pr = SessionResource("pr", "github", "Fix a bug", "https://github.com/example/repo/pull/42", "merged", number = 42)
    @Test fun contractAcceptsExtraBackendFieldsAndNativeLinearState() {
        val decoded = Http.json.decodeFromString<SessionResourcesEnvelope>("""{"resources":[{"id":"issue","provider":"linear","title":"NUPS-1 A title","url":"https://linear.app/example/issue/NUPS-1","state":"In Review","stateType":"started","linkedAt":"now","future":true}],"canManage":true}""")
        assertEquals("NUPS-1", decoded.resources.single().chip)
        assertEquals("In Review", decoded.resources.single().state)
        assertEquals("started", decoded.resources.single().stateType)
        assertEquals("#42", pr.chip)
        assertThrows(Exception::class.java) { Http.json.decodeFromString<SessionResourcesEnvelope>("{}") }
    }
    @Test fun rejectsUnsafeUrlsWithoutDisablingResourceTitles() {
        for (url in listOf("javascript:alert(1)", "intent://github.com", "file:///etc/passwd", "http://github.com", "https://user:secret@github.com", "https:///missing", "https://github.com\n", "https://evil.example/pull/1", "https://github.com.evil.com/x", "https://github.com:8443/x", "https://github.com:443/x", "https://linear.app/x")) {
            assertNull(url, pr.copy(url = url).safeUrl)
        }
        assertEquals(pr.url, pr.safeUrl)
        assertNull(pr.copy(provider = "linear").safeUrl)
        assertNull(pr.copy(provider = "unknown").safeUrl)
        val linearUrl = "https://linear.app/example/issue/SYN-1"
        assertEquals(linearUrl, pr.copy(provider = "linear", url = linearUrl).safeUrl)
        assertEquals("https://GITHUB.com/example", pr.copy(url = "https://GITHUB.com/example").safeUrl)
        assertEquals("GitHub", pr.providerLabel)
    }
    @Test fun emptyIsSuccessAndUnknownProvidersAreIgnored() = runTest {
        val state = SessionResourcesStore { listOf(pr, pr, pr.copy(id = "thread", provider = "slack")) }
        state.refresh(); assertTrue(state.hasLoaded); assertEquals(listOf(pr), state.resources)
        val empty = SessionResourcesStore { emptyList() }
        empty.refresh(); assertFalse(empty.failed); assertFalse(empty.loading); assertTrue(empty.resources.isEmpty())
    }
    @Test fun failureClearsStaleLinksAndCanRetry() = runTest {
        var denied = false
        val state = SessionResourcesStore { if (denied) throw NuphosApi.Failure.Http(403, "private error") else listOf(pr) }
        state.refresh(); denied = true; state.refresh()
        assertTrue(state.failed); assertTrue(state.hasLoaded); assertFalse(state.loading); assertTrue(state.resources.isEmpty())
        denied = false; state.refresh(); assertFalse(state.failed); assertEquals(listOf(pr), state.resources)
    }
    @Test fun olderResponseCannotReplaceNewRefreshOrRepublishAfterInvalidation() = runTest {
        val pending = CompletableDeferred<List<SessionResource>>()
        var first = true
        val state = SessionResourcesStore { if (first) { first = false; pending.await() } else listOf(pr.copy(state = "closed")) }
        val old = async { state.refresh() }; yield()
        state.refresh(); pending.complete(listOf(pr)); old.await()
        assertEquals("closed", state.resources.single().state)
        val late = CompletableDeferred<List<SessionResource>>()
        val disposed = SessionResourcesStore { late.await() }
        val job = async { disposed.refresh() }; yield(); disposed.invalidate()
        late.complete(listOf(pr)); job.await(); assertTrue(disposed.resources.isEmpty()); assertFalse(disposed.hasLoaded)
    }
    @Test fun revokedConsentAndCancellationCannotPublishLateResults() = runTest {
        var allowed = true
        val late = CompletableDeferred<List<SessionResource>>()
        val state = SessionResourcesStore { late.await() }
        val job = async { state.refresh { allowed } }; yield(); allowed = false
        late.complete(listOf(pr)); job.await()
        assertTrue(state.resources.isEmpty()); assertFalse(state.failed)
        var calls = 0
        val blocked = SessionResourcesStore { calls++; listOf(pr) }
        blocked.refresh { false }; assertEquals(0, calls)
        val never = CompletableDeferred<List<SessionResource>>()
        val cancelled = SessionResourcesStore { never.await() }
        val cancelledJob = async { cancelled.refresh() }; yield(); cancelledJob.cancel(); cancelledJob.join()
        assertFalse(cancelled.hasLoaded); assertFalse(cancelled.failed); assertFalse(cancelled.loading); assertTrue(cancelled.resources.isEmpty())
    }
}
