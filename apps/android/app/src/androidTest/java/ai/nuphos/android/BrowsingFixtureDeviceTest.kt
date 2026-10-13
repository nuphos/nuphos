package ai.nuphos.android

import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.nuphos.android.data.BrowsingTransport
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.AgentConversationsPage
import ai.nuphos.android.session.MonitoringStore
import ai.nuphos.android.session.TriggersStore
import ai.nuphos.android.session.TriggerRunsStore
import ai.nuphos.android.ui.monitoring.MonitoringPage
import ai.nuphos.android.ui.triggers.TriggersPage
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import ai.nuphos.android.data.Http
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Before
import org.junit.After
import org.junit.Rule
import ai.nuphos.android.data.BrowsingHttpFailure
import org.junit.Test
import org.junit.runner.RunWith

/** Synthetic browsing data; page transports never reach a server. */
@RunWith(AndroidJUnit4::class)
class BrowsingFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<androidx.activity.ComponentActivity>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private lateinit var app: NuphosApplication
    private var savedToken: String? = null
    @Before fun blockBackgroundNetwork() {
        app = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
        savedToken = app.tokenStore.read()
        val fixture = OkHttpClient.Builder().addInterceptor { chain ->
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200)
                .message("fixture").body("{}".toResponseBody(Http.jsonMedia)).build()
        }.build()
        for (name in listOf("client", "chatClient")) {
            val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
            originals[name] = field.get(null) as OkHttpClient
            field.set(null, fixture)
        }
    }
    @After fun restoreBackgroundNetwork() {
        assertEquals("Browsing fixture changed installed token (values withheld)", savedToken == app.tokenStore.read(), true)
        for ((name, client) in originals) Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client)
    }
    private val team = "0123456789abcdef01234567"
    private val trigger = "abcdef0123456789abcdef01"
    private fun json(text: String) = requireNotNull(JsonValue.parse(text))

    @Test fun monitoringPartialErrorSearchAndInformation() {
        val store = MonitoringStore(BrowsingTransport { _, _ -> json("""{"rows":[{"provider":"grafana","integrationId":"binding","integrationLabel":"Grafana fixture","providerResourceId":"alert","kind":"alert","name":"Fixture firing alert","status":"firing","statusLabel":"Firing","providerUrl":"javascript:alert(1)"}],"providerErrors":[{"provider":"gcp","integrationId":"gcp","message":"Provider unavailable"}]}""") })
        runBlocking { store.select(team) }
        compose.runOnIdle { compose.activity.setContent { NuphosTheme { MonitoringPage(store, team, {}) } } }
        compose.onNodeWithText("Fixture firing alert").assertIsDisplayed()
        compose.onAllNodesWithText("Firing").onLast().assertIsDisplayed()
        compose.onNodeWithText("Some providers could not be loaded").assertIsDisplayed()
        compose.onNodeWithText("Search monitoring").performTextInput("missing")
        compose.onNodeWithText("No matching checks").assertIsDisplayed()
        compose.onNodeWithText("Clear filters").performClick()
        compose.onNodeWithText("Fixture firing alert").performClick()
        compose.onNodeWithText("Open provider").assertDoesNotExist()
        compose.onNodeWithText("Close").performClick()
        compose.onNodeWithText("Fixture firing alert").assertIsDisplayed()
    }

    @Test fun monitoringErrorsCollapseAndTechnicalDetailsStayAvailable() {
        val target = "sum by (region) (a_very_long_metric_name_that_must_remain_readable)"
        val store = MonitoringStore(BrowsingTransport { _, _ -> json("""{"rows":[{"provider":"grafana","integrationId":"binding","integrationLabel":"Grafana fixture","providerResourceId":"alert","kind":"alert","name":"Fixture check","status":"firing","target":"$target"}],"providerErrors":[{"provider":"gcp","integrationId":"gcp-one","integrationLabel":"First project","message":"Provider unavailable"},{"provider":"gcp","integrationId":"gcp-two","integrationLabel":"Second project","message":"Provider unavailable"}]}""") })
        runBlocking { store.select(team) }
        compose.runOnIdle { compose.activity.setContent { NuphosTheme { MonitoringPage(store, team, {}) } } }
        compose.onNodeWithText("$target", substring = true).assertDoesNotExist()
        compose.onNodeWithText("gcp · First project: Could not load this provider. Refresh to try again.").assertDoesNotExist()
        compose.onNodeWithText("Show provider errors").performClick()
        compose.onNodeWithText("gcp · First project: Could not load this provider. Refresh to try again.").assertIsDisplayed()
        compose.onNodeWithText("gcp · Second project: Could not load this provider. Refresh to try again.").assertIsDisplayed()
        compose.onNodeWithText("Hide provider errors").performClick()
        compose.onNodeWithText("Fixture check").performScrollTo().performClick()
        compose.onNodeWithText("Target: $target").assertDoesNotExist()
        compose.onNodeWithText("Technical details").performScrollTo().performClick()
        compose.onNodeWithText("Target: $target").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Open provider").assertDoesNotExist()
    }

    @Test fun emptyMonitoringOffersConnectors() {
        var opened = false
        val store = MonitoringStore(BrowsingTransport { _, _ -> json("""{"rows":[],"providerErrors":[]}""") })
        runBlocking { store.select(team) }
        compose.runOnIdle { compose.activity.setContent { NuphosTheme { MonitoringPage(store, team, { opened = true }) } } }
        compose.onNodeWithText("No monitoring checks").assertIsDisplayed()
        compose.onNodeWithText("Open Connectors").performClick()
        compose.runOnIdle { assertTrue(opened) }
    }

    @Test fun triggerDetailAndRunsRemainReadOnly() {
        val calls = mutableListOf<String>()
        val store = TriggersStore(BrowsingTransport { _, path ->
            calls.add(path)
            if (path.endsWith("scheduler-status")) json("""{"cronEnabled":false}""") else json("""[{"id":"$trigger","name":"Fixture UTC cron","triggerType":"cron","enabled":true,"cronExpression":"0 * * * *","executionPrincipalUserId":"fixture-principal","executionAuthorizationStatus":"active","cleanupStatus":"pending","watchGroupId":"group-fixture","expiresAt":"2099-01-01T00:00:00Z","webhookSecret":"NEVER_DISPLAY"}]""")
        })
        val runs = TriggerRunsStore { requestedTeam, requestedTrigger, _ ->
            assertEquals(team, requestedTeam); assertEquals(trigger, requestedTrigger)
            AgentConversationsPage(listOf(AgentConversation("fixture-run", team, title = "Existing fixture run")))
        }
        var opened: Pair<String, String>? = null
        runBlocking { store.select(team) }
        compose.runOnIdle { compose.activity.setContent { NuphosTheme { TriggersPage(store, runs, team, { id, selectedTeam -> opened = id to selectedTeam }) } } }
        compose.onNodeWithText("Cron scheduler is unavailable").assertIsDisplayed()
        compose.onNodeWithText("Search triggers").performTextInput("missing")
        compose.onNodeWithText("No matching triggers").assertIsDisplayed()
        compose.onNodeWithText("Clear filters").performClick()
        compose.onNodeWithText("webhook").performClick()
        compose.onNodeWithText("No matching triggers").assertIsDisplayed()
        compose.onNodeWithText("Clear filters").performClick()
        compose.onNodeWithText("Fixture UTC cron").performClick()
        compose.onNodeWithText("Schedule (UTC): 0 * * * *").assertIsDisplayed()
        compose.onNodeWithText("Expires:", substring = true).performScrollTo().assertTextContains("2099", substring = true)
        compose.onNodeWithText("Principal: fixture-principal").assertDoesNotExist()
        compose.onNodeWithText("Technical details").performScrollTo().performClick()
        compose.onNodeWithText("Principal: fixture-principal").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("NEVER_DISPLAY", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Existing runs").performScrollTo().performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Existing fixture run").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Existing fixture run").performClick()
        compose.runOnIdle { assertEquals("fixture-run" to team, opened) }
        listOf("Run now", "Edit", "Delete", "Approve", "Send").forEach { compose.onNodeWithText(it).assertDoesNotExist() }
        assertTrue(calls.all { it.endsWith("agent-triggers") || it.endsWith("scheduler-status") })
    }
    @Test fun compactLargeTextDetailRemainsScrollableAndBackReturnsList() {
        val longName = "A long fixture trigger name with enough words to wrap at a compact phone width"
        val store = TriggersStore(BrowsingTransport { _, path ->
            if (path.endsWith("scheduler-status")) json("""{"cronEnabled":true}""") else json("""[{"id":"$trigger","name":"$longName","triggerType":"webhook","enabled":false,"executionPrincipalUserId":"fixture-principal","cleanupStatus":"pending","watchGroupId":"group-fixture"}]""")
        })
        val runs = TriggerRunsStore { _, _, _ -> AgentConversationsPage() }
        runBlocking { store.select(team) }
        compose.runOnIdle { compose.activity.setContent {
            NuphosTheme { CompositionLocalProvider(LocalDensity provides Density(compose.activity.resources.displayMetrics.density, 1.3f)) {
                Box(Modifier.width(320.dp)) { TriggersPage(store, runs, team, { _, _ -> }) }
            } }
        } }
        compose.onNodeWithText(longName).performScrollTo().performClick()
        compose.onNodeWithText("Existing runs").performScrollTo().performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("No existing runs").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Back to trigger").performScrollTo().performClick()
        compose.onNodeWithText("Back to triggers").performScrollTo().performClick()
        compose.onNodeWithText(longName).assertIsDisplayed()
    }

    @Test fun staleFailureAndDenialAreDifferentFromEmpty() {
        var denied = false
        var failed = false
        val store = MonitoringStore(BrowsingTransport { _, _ ->
            if (denied) throw BrowsingHttpFailure(403)
            if (failed) error("fixture failure")
            json("""{"rows":[{"provider":"grafana","integrationId":"binding","providerResourceId":"alert","kind":"alert","name":"Retained fixture check","status":"unknown","statusLabel":"Unknown"}],"providerErrors":[]}""")
        })
        runBlocking { store.select(team) }
        compose.runOnIdle { compose.activity.setContent { NuphosTheme { MonitoringPage(store, team, {}) } } }
        compose.waitForIdle()
        failed = true
        compose.onNodeWithText("Refresh").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Stale data", substring = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Retained fixture check").assertIsDisplayed()
        denied = true
        compose.onNodeWithText("Refresh").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Monitoring access denied.", substring = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Retained fixture check").assertDoesNotExist()
        compose.onNodeWithText("No monitoring checks").assertDoesNotExist()
    }

}
