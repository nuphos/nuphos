package ai.nuphos.android

import androidx.activity.compose.setContent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.nuphos.android.data.BrowsingTransport
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.session.MonitoringStore
import ai.nuphos.android.ui.monitoring.MonitoringPage
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
