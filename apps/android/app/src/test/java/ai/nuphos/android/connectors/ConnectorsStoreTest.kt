package ai.nuphos.android.connectors

import ai.nuphos.android.data.*
import ai.nuphos.android.model.*
import ai.nuphos.android.session.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class ConnectorsStoreTest {
    private val admin = Team("team", role = "ADMINISTRATOR")
    @Test fun directMemberAddMakesZeroRequests() = runTest {
        var calls = 0
        val store = ConnectorsStore(ConnectorTransport { _, _, _, _, _ -> calls++; JsonValue.Null })
        store.select(Team("team", role = "MEMBER"))
        calls = 0
        assertFalse(store.bind(ConnectorCatalog.named("notion")!!, mapOf("label" to "a", "token" to "secret")))
        assertNull(store.start(ConnectorCatalog.named("linear")!!))
        assertEquals(0, calls)
    }
    @Test fun slowOldTeamCannotReplaceNewTeam() = runTest {
        val old = CompletableDeferred<JsonValue>()
        val store = ConnectorsStore(ConnectorTransport { _, team, _, _, _ -> if (team == "old") old.await() else JsonValue.parse("""{"notion":[{"id":"new"}]}""")!! })
        val first = async { store.select(Team("old")) }
        kotlinx.coroutines.yield()
        store.select(Team("new"))
        old.complete(JsonValue.parse("""{"notion":[{"id":"old"}]}""")!!)
        first.await()
        assertEquals("new", store.inventory.rows.single().bindingId)
    }
    @Test fun bindNeedsInventoryReadbackAndDuplicateTapMakesOnePost() = runTest {
        var posts = 0
        val response = CompletableDeferred<JsonValue>()
        val store = ConnectorsStore(ConnectorTransport { method, _, _, _, _ ->
            if (method == "POST") { posts++; response.await() } else JsonValue.parse("""{"notion":[{"id":"saved"}]}""")!!
        })
        store.select(admin)
        val first = async { store.bind(ConnectorCatalog.named("notion")!!, mapOf("label" to "a", "token" to "secret")) }
        kotlinx.coroutines.yield()
        assertFalse(store.bind(ConnectorCatalog.named("notion")!!, mapOf("label" to "a", "token" to "secret")))
        response.complete(JsonValue.obj("id" to JsonValue.Str("saved")))
        assertTrue(first.await())
        assertEquals(1, posts)
    }
    @Test fun missingReadbackNeverClaimsSuccess() = runTest {
        val store = ConnectorsStore(ConnectorTransport { method, _, _, _, _ -> if (method == "POST") JsonValue.obj("id" to JsonValue.Str("missing")) else JsonValue.obj() })
        store.select(admin)
        assertFalse(store.bind(ConnectorCatalog.named("notion")!!, mapOf("label" to "a", "token" to "secret")))
        assertNotNull(store.actionError)
    }
    @Test fun canceledOAuthCleansOriginalTeamAndIgnoresLateCallback() = runTest {
        val requests = mutableListOf<String>()
        val store = ConnectorsStore(ConnectorTransport { method, team, path, _, _ ->
            requests.add("$method:$team:$path")
            if (method == "POST") JsonValue.parse("""{"authorizeUrl":"https://provider.example/oauth","state":"abc","expiresAt":"2030-01-01T00:00:00Z"}""")!! else JsonValue.obj()
        }, now = { 0 })
        store.select(admin)
        store.start(ConnectorCatalog.named("linear")!!)
        store.cancel()
        val count = requests.size
        store.handleCallback("nuphos://linear-callback?state=abc&team_id=team&binding_id=b")
        assertTrue(requests.contains("DELETE:team:linear-workspaces/start-oauth/abc"))
        assertEquals(count, requests.size)
        assertNull(store.pending)
    }
    @Test fun retiredCallbackCannotCancelTheNextAuthorization() = runTest {
        var starts = 0
        val requests = mutableListOf<String>()
        val store = ConnectorsStore(ConnectorTransport { method, _, path, _, _ ->
            requests += "$method:$path"
            if (method == "POST") {
                starts++
                JsonValue.parse("""{"authorizeUrl":"https://provider.example/oauth","state":"abc$starts","expiresAt":"2030-01-01T00:00:00Z"}""")!!
            } else JsonValue.obj()
        }, now = { 0 })
        store.select(admin)
        store.start(ConnectorCatalog.named("linear")!!)
        store.cancel()
        store.start(ConnectorCatalog.named("linear")!!)
        val next = store.pending
        val count = requests.size
        store.handleCallback("nuphos://linear-callback?state=unrelated&team_id=team&binding_id=unknown")
        assertEquals(next, store.pending)
        assertEquals(count, requests.size)
        store.handleCallback("nuphos://linear-callback?state=abc1&team_id=team&binding_id=old")
        assertEquals(next, store.pending)
        assertEquals(count, requests.size)
    }
    @Test fun emptyFailureAndRetryAreDistinct() = runTest {
        var fail = true
        val store = ConnectorsStore(ConnectorTransport { _, _, _, _, _ -> if (fail) error("private token must not surface") else JsonValue.obj() })
        store.select(admin)
        assertEquals(ConnectorsStore.Phase.Failed, store.phase)
        assertFalse(store.loadError.orEmpty().contains("private token"))
        fail = false
        assertTrue(store.refresh())
        assertEquals(ConnectorsStore.Phase.Loaded, store.phase)
        assertTrue(store.inventory.rows.isEmpty())
    }
    @Test fun uncertainLostSaveBlocksDuplicateUntilFormReview() = runTest {
        var posts = 0
        val store = ConnectorsStore(ConnectorTransport { method, _, _, _, _ -> if (method == "POST") { posts++; error("lost response") } else JsonValue.obj() })
        store.select(admin)
        val provider = ConnectorCatalog.named("notion")!!
        val values = mapOf("label" to "a", "token" to "secret")
        assertFalse(store.bind(provider, values))
        assertTrue(store.uncertain)
        assertFalse(store.bind(provider, values))
        assertEquals(1, posts)
        assertEquals("secret", values["token"])
    }
    @Test fun confirmedBadFieldsPermitCorrectedRetry() = runTest {
        var posts = 0
        val store = ConnectorsStore(ConnectorTransport { method, _, _, _, _ -> if (method == "POST") { posts++; throw ConnectorHttpFailure(400) } else JsonValue.obj() })
        store.select(admin)
        val provider = ConnectorCatalog.named("notion")!!
        assertFalse(store.bind(provider, mapOf("label" to "a", "token" to "bad")))
        assertFalse(store.uncertain)
        assertFalse(store.bind(provider, mapOf("label" to "a", "token" to "corrected")))
        assertEquals(2, posts)
    }
    @Test fun recreatedPendingFlowRequiresReadbackAndIsConsumedOnce() = runTest {
        var saved: ConnectorPending? = ConnectorPending("team", "linear", "abc", 1000)
        val storage = object : ConnectorPendingStorage {
            override fun read() = saved
            override fun write(pending: ConnectorPending?) { saved = pending }
        }
        var calls = 0
        val store = ConnectorsStore(ConnectorTransport { _, _, _, _, _ -> calls++; JsonValue.parse("""{"linear":[{"id":"b"}]}""")!! }, storage, now = { 0 })
        store.select(admin)
        store.handleCallback("nuphos://linear-callback?state=abc&team_id=team&binding_id=b")
        assertEquals("Connector saved and verified.", store.notice)
        assertNull(saved)
        val count = calls
        store.handleCallback("nuphos://linear-callback?state=abc&team_id=team&binding_id=b")
        assertEquals(count, calls)
    }
    @Test fun oauthMissingInventoryAndWrongTeamNeverConfirm() = runTest {
        val storage = object : ConnectorPendingStorage {
            override fun read() = ConnectorPending("team", "linear", "abc", 1000)
            override fun write(pending: ConnectorPending?) {}
        }
        val requests = mutableListOf<String>()
        val store = ConnectorsStore(ConnectorTransport { method, team, path, _, _ -> requests.add("$method:$team:$path"); JsonValue.obj() }, storage, now = { 0 })
        store.select(admin)
        store.handleCallback("nuphos://linear-callback?state=abc&team_id=team&binding_id=missing")
        assertNull(store.notice)
        assertNotNull(store.actionError)
        val wrong = ConnectorsStore(ConnectorTransport { method, team, path, _, _ -> requests.add("$method:$team:$path"); JsonValue.obj() }, storage, now = { 0 })
        wrong.select(admin)
        wrong.handleCallback("nuphos://linear-callback?state=abc&team_id=other&binding_id=b")
        assertTrue(requests.contains("DELETE:team:linear-workspaces/start-oauth/abc"))
        assertFalse(requests.any { it.startsWith("POST:") })
    }
    @Test fun githubBindsOnceAndUsesInstallationReadbackWithoutPendingDelete() = runTest {
        val storage = object : ConnectorPendingStorage {
            override fun read() = ConnectorPending("team", "github", "abc", 1000)
            override fun write(pending: ConnectorPending?) {}
        }
        val requests = mutableListOf<String>()
        val store = ConnectorsStore(ConnectorTransport { method, _, path, body, _ ->
            requests.add("$method:$path")
            if (method == "POST") { assertEquals(42.0, body?.get("installationId")?.numberValue); JsonValue.obj("id" to JsonValue.Str("binding")) }
            else JsonValue.parse("""{"github":[{"id":"binding","installationId":42}]}""")!!
        }, storage, now = { 0 })
        store.select(admin)
        val uri = "nuphos://github-callback?state=abc&installation_id=42"
        store.handleCallback(uri)
        store.handleCallback(uri)
        assertEquals("Connector saved and verified.", store.notice)
        assertEquals(1, requests.count { it == "POST:github-installations" })
        assertFalse(requests.any { it.startsWith("DELETE:") })
    }
    @Test fun timeoutAndTeamSwitchInvalidateOriginalPendingFlow() = runTest {
        var time = 0L
        val storage = object : ConnectorPendingStorage {
            override fun read() = ConnectorPending("team", "linear", "abc", 1000)
            override fun write(pending: ConnectorPending?) {}
        }
        val requests = mutableListOf<String>()
        val store = ConnectorsStore(ConnectorTransport { method, team, path, _, _ -> requests.add("$method:$team:$path"); JsonValue.obj() }, storage, now = { time })
        store.select(admin)
        time = 1000
        store.expire()
        assertNull(store.pending)
        assertTrue(requests.contains("DELETE:team:linear-workspaces/start-oauth/abc"))
        val other = ConnectorsStore(ConnectorTransport { method, team, path, _, _ -> requests.add("$method:$team:$path"); JsonValue.obj() }, storage, now = { 0 })
        other.select(Team("other", role = "ADMINISTRATOR"))
        other.handleCallback("nuphos://linear-callback?state=abc&team_id=team&binding_id=b")
        assertEquals("other", other.team?.id)
        assertNull(other.pending)
        assertFalse(requests.any { it.startsWith("POST:") })
    }

}
