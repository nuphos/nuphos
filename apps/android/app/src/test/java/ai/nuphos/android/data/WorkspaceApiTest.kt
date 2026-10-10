package ai.nuphos.android.data

import kotlinx.coroutines.test.runTest
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

class WorkspaceApiTest {
    private val id = "507f1f77bcf86cd799439011"
    private val requests = mutableListOf<Request>()
    private var status = 201
    private var response = """{"team":{"id":"507f1f77bcf86cd799439011","name":"Saved","role":"EDITOR","isOwner":false}}"""
    private val api = WorkspaceApi("synthetic-token", OkHttpClient.Builder().addInterceptor {
        requests += it.request()
        Response.Builder().request(it.request()).protocol(Protocol.HTTP_1_1).code(status).message("fixture")
            .body(response.toResponseBody(Http.jsonMedia)).build()
    }.build())
    @Test fun createTrimsAndJoinUsesEmptyBodyAndPreservesMembership() = runTest {
        assertEquals("EDITOR", api.create(" Saved ").role)
        assertEquals("""{"name":"Saved"}""", Buffer().also { requests.last().body!!.writeTo(it) }.readUtf8())
        assertEquals("/teams", requests.last().url.encodedPath)
        assertFalse(api.join(id).isOwner!!)
        assertEquals("/teams/discoverable/$id/join", requests.last().url.encodedPath)
        assertEquals(0L, requests.last().body!!.contentLength())
        requests.forEach { assertEquals("Bearer synthetic-token", it.header("Authorization")) }
    }
    @Test fun validationMakesNoRequest() = runTest {
        for (name in listOf("  ", "a".repeat(81))) {
            try { api.create(name); fail() } catch (_: IllegalArgumentException) { }
        }
        try { api.join("../wrong"); fail() } catch (_: IllegalArgumentException) { }
        assertTrue(requests.isEmpty()); api.create("a".repeat(80))
    }
    @Test fun discoveryEmptyIsValidButMissingEnvelopeIsNot() = runTest {
        status = 200; response = """{"teams":[]}"""
        assertTrue(api.discoverable().isEmpty())
        assertEquals("/teams/discoverable", requests.last().url.encodedPath)
        response = "{}"
        try { api.memberships(); fail() } catch (_: NuphosApi.Failure.InvalidResponse) { }
    }
    @Test fun only401ExpiresAndOtherErrorsKeepStatus() = runTest {
        response = """{"error":{"code":"domain_not_allowed","message":"Denied"}}"""
        for (code in listOf(400, 403, 404, 409, 500)) {
            status = code
            try { api.join(id); fail() } catch (e: NuphosApi.Failure.Http) { assertEquals(code, e.code) }
        }
        status = 401
        try { api.join(id); fail() } catch (_: NuphosApi.Failure.Unauthorized) { }
    }
    @Test fun onlyExactAlreadyMemberCodeHasMembershipRefreshMeaning() = runTest {
        status = 409; response = """{"error":{"code":"already_member","message":"Already joined"}}"""
        try { api.join(id); fail() } catch (_: WorkspaceAlreadyMember) { }
        response = """{"error":{"code":"other_conflict","message":"Already joined"}}"""
        try { api.join(id); fail() } catch (e: NuphosApi.Failure.Http) { assertEquals(409, e.code) }
    }
    @Test fun writeNeeds201AndExactTeamEnvelope() = runTest {
        status = 200
        try { api.create("Saved"); fail() } catch (_: NuphosApi.Failure.InvalidResponse) { }
        status = 201; response = "{}"
        try { api.create("Saved"); fail() } catch (_: NuphosApi.Failure.InvalidResponse) { }
    }
}
