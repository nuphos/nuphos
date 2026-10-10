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
    private val trigger = "0123456789abcdef01234567"
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
    @Test fun quotedNumericProviderAndTriggerIdsRemainValidStrings() {
        val overview = MonitoringOverview.decode(json("""{"rows":[{"provider":"betterstack","integrationId":"123","providerResourceId":"456","kind":"monitor","statusLabel":"up"}]}"""))
        assertEquals("123", overview.rows.single().integrationId)
        assertEquals("456", overview.rows.single().providerResourceId)
        val rows = TriggerRow.decodeList(json("""[{"id":"000000000000000000000001","triggerType":"webhook","enabled":true}]"""))
        assertEquals("000000000000000000000001", rows.single().id)
    }
    @Test fun triggerDecoderIsolatesInvalidRowsAndKeepsUtcMetadata() {
        val rows = TriggerRow.decodeList(json("""[{"id":"$trigger","name":"Cron","triggerType":"cron","enabled":true,"cronExpression":"0 0 * * *","nextRuns":["2026-10-05T00:00:00Z"],"executionPrincipalUserId":"user","executionAuthorizationStatus":"valid","cleanupStatus":"cleanup_failed","webhookSecret":"SECRET","future":{"token":"SECRET"}},{"id":"bad"}]"""))
        assertEquals(1, rows.size)
        assertEquals("UTC", rows.single().scheduleTimezone)
        assertEquals(listOf("2026-10-05T00:00:00Z"), rows.single().nextRuns)
        assertFalse(rows.toString().contains("SECRET"))
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
    @Test fun schedulerFailureDoesNotDiscardList() = runTest {
        val store = TriggersStore(BrowsingTransport { _, path -> if (path.endsWith("scheduler-status")) error("SECRET") else json("""[{"id":"$trigger","name":"Cron","triggerType":"cron","enabled":true}]""") })
        store.select("team")
        assertEquals(1, store.rows.size); assertNotNull(store.schedulerError)
        assertFalse(store.schedulerError.orEmpty().contains("SECRET"))
    }
    @Test fun selectorIsExplicitTeamScopedAndInvalidNeverFallsBack() {
        val query = NuphosApi.conversationQuery("team", triggerId = trigger)
        assertTrue(query.contains("triggerId" to trigger)); assertTrue(query.contains("scope" to "team"))
        assertFalse(NuphosApi.conversationQuery("team").any { it.first == "triggerId" })
        for (id in listOf("", "bad")) {
            try { NuphosApi.conversationQuery("team", triggerId = id); fail("Invalid selector accepted") } catch (_: IllegalArgumentException) { }
        }
        try { NuphosApi.conversationQuery("", triggerId = trigger); fail("Missing team accepted") } catch (_: IllegalArgumentException) { }
    }
    @Test fun invalidSelectorRejectsBeforeNetworkAndOrdinaryChatsKeepParameters() = runTest {
        try { NuphosApi.conversations("unused", "team", triggerId = ""); fail("Invalid network selector accepted") } catch (_: IllegalArgumentException) { }
        val ordinary = NuphosApi.conversationQuery("team", cursor = "next", scope = ConversationScope.Mine, search = "search", archivedOnly = true)
        assertEquals(listOf("teamId" to "team", "limit" to "30", "scope" to "mine", "cursor" to "next", "search" to "search", "archived" to "only"), ordinary)
    }
    @Test fun triggerListCapUnknownOptionalFieldsAndDeniedState() = runTest {
        val unknown = TriggerRow.decodeList(json("""[{"id":"$trigger","triggerType":"future","enabled":false,"future":"value"}]"""))
        assertEquals("future", unknown.single().triggerType)
        val input = JsonValue.Arr((0..100).map { index -> json("""{"id":"abc${index.toString(16).padStart(21, '0')}","triggerType":"webhook","enabled":true}""") })
        assertEquals(100, TriggerRow.decodeList(input).size)
        var denied = false
        val store = TriggersStore(BrowsingTransport { _, path ->
            if (denied) throw BrowsingHttpFailure(403)
            if (path.endsWith("scheduler-status")) json("""{"cronEnabled":false}""") else JsonValue.Arr(listOf(input[0]!!))
        })
        store.select("team"); assertEquals(false, store.cronEnabled)
        denied = true; store.refresh()
        assertEquals(BrowsingPhase.Denied, store.phase); assertTrue(store.rows.isEmpty()); assertNull(store.cronEnabled)
    }
    @Test fun runDenialClearsDataAndWrongTeamRowsAreIsolated() = runTest {
        var denied = false
        val store = TriggerRunsStore { _, _, _ ->
            if (denied) throw NuphosApi.Failure.Unauthorized
            AgentConversationsPage(listOf(AgentConversation("allowed", teamId = "team"), AgentConversation("wrong", teamId = "other")))
        }
        store.select("team", trigger); assertEquals(listOf("allowed"), store.rows.map { it.id })
        denied = true; store.refresh()
        assertEquals(BrowsingPhase.Denied, store.phase); assertTrue(store.rows.isEmpty())
    }
    @Test fun runPagingDeduplicatesAndInvalidSelectorMakesNoRequests() = runTest {
        var calls = 0
        val store = TriggerRunsStore { team, id, cursor ->
            calls++; assertEquals("team", team); assertEquals(trigger, id)
            if (cursor == null) AgentConversationsPage(listOf(AgentConversation("one", teamId = team)), "next", true)
            else AgentConversationsPage(listOf(AgentConversation("one", teamId = team), AgentConversation("two", teamId = team)))
        }
        store.select("team", ""); assertEquals(0, calls)
        store.select("team", trigger); store.loadMore()
        assertEquals(listOf("one", "two"), store.rows.map { it.id }); assertFalse(store.hasMore)
    }
    @Test fun lateRunSelectionCannotReplaceCurrentRuns() = runTest {
        val old = CompletableDeferred<AgentConversationsPage>()
        val next = "abcdef0123456789abcdef01"
        val store = TriggerRunsStore { team, id, _ -> if (id == trigger) old.await() else AgentConversationsPage(listOf(AgentConversation("new", teamId = team))) }
        val pending = async { store.select("team", trigger) }; yield()
        store.select("team", next); old.complete(AgentConversationsPage(listOf(AgentConversation("old", teamId = "team")))); pending.await()
        assertEquals("new", store.rows.single().id)
    }
}
