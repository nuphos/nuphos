package ai.nuphos.android.browsing

import ai.nuphos.android.data.*
import ai.nuphos.android.model.*
import ai.nuphos.android.session.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.Assert.*
import org.junit.Test

class BrowsingContractTest {
    private fun json(text: String) = JsonValue.parse(text)!!
    private fun overview(binding: String) = json("""{"rows":[{"provider":"grafana","integrationId":"$binding","providerResourceId":"same","kind":"alert-rule","name":"Alert","status":"down","statusLabel":"firing"}]}""")
    @Test fun providerLinksRequireHttpsHostAndNoCredentials() {
        assertEquals("https://provider.example/a", providerHttpsUrl("https://provider.example/a"))
        for (value in listOf("http://provider.example", "https://user:pass@provider.example", "javascript:alert(1)", "https:///missing", "not a url")) assertNull(providerHttpsUrl(value))
    }
    @Test fun monitoringRequiresArrayRowsInsteadOfInventingEmpty() {
        for (value in listOf("{}", "{\"rows\":{}}", "{\"rows\":null}")) {
            try { MonitoringOverview.decode(json(value)); fail("Missing or malformed rows accepted") } catch (_: IllegalArgumentException) { }
        }
        assertTrue(MonitoringOverview.decode(json("{\"rows\":[]}")).rows.isEmpty())
    }
    @Test fun monitoringKeepsNativeStatusAndIntegrationIdentityWithoutSecrets() {
        val source = json("""{"rows":[{"provider":"grafana","integrationId":"a","providerResourceId":"same","kind":"alert-rule","statusLabel":"firing","token":"SECRET"},{"provider":"grafana","integrationId":"b","providerResourceId":"same","kind":"alert-rule"},{"provider":"gcp"}],"providerErrors":[{"provider":"gcp","integrationId":"c","message":"SECRET"}]}""")
        val decoded = MonitoringOverview.decode(source)
        assertEquals(2, decoded.rows.size)
        assertNotEquals(decoded.rows[0].id, decoded.rows[1].id)
        assertEquals("firing", decoded.rows[0].statusLabel)
        assertEquals(1, decoded.providerErrors.size)
        assertFalse(decoded.toString().contains("SECRET"))
    }
    @Test fun quotedNumericProviderIdsRemainValidStrings() {
        val overview = MonitoringOverview.decode(json("""{"rows":[{"provider":"betterstack","integrationId":"123","providerResourceId":"456","kind":"monitor","statusLabel":"up"}]}"""))
        assertEquals("123", overview.rows.single().integrationId)
        assertEquals("456", overview.rows.single().providerResourceId)
    }
    @Test fun oldTeamResultCannotReplaceNewTeam() = runTest {
        val old = CompletableDeferred<JsonValue>()
        val store = MonitoringStore(BrowsingTransport { team, _ -> if (team == "a") old.await() else overview("b") })
        val pending = async { store.select("a") }; yield()
        store.select("b"); old.complete(overview("a")); pending.await()
        assertEquals("b", store.overview.rows.single().integrationId)
    }
    @Test fun failedRefreshRetainsStaleRowsButDenialClearsThem() = runTest {
        var code = 0
        val store = MonitoringStore(BrowsingTransport { _, _ -> if (code == 0) overview("a") else throw BrowsingHttpFailure(code) })
        store.select("a"); code = 500; store.refresh()
        assertTrue(store.stale); assertEquals(1, store.overview.rows.size)
        code = 403; store.refresh()
        assertEquals(BrowsingPhase.Denied, store.phase); assertTrue(store.overview.rows.isEmpty())
    }
    @Test fun ordinaryChatsKeepParameters() {
        val ordinary = NuphosApi.conversationQuery("team", cursor = "next", scope = ConversationScope.Mine, search = "search")
        assertEquals(listOf("teamId" to "team", "limit" to "30", "sort" to "activity", "scope" to "mine", "cursor" to "next", "search" to "search", "archived" to "exclude"), ordinary)
    }
}
