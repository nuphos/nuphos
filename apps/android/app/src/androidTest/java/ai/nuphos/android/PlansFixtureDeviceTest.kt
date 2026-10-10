package ai.nuphos.android

import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.nuphos.android.data.Http
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.PlansStore
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalPlansStore
import ai.nuphos.android.ui.plans.PlansPage
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.*
import org.junit.runner.RunWith

/** Isolated plan responses; all HTTP stays inside the fixture. */
@RunWith(AndroidJUnit4::class)
class PlansFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private lateinit var plans: PlansStore
    private var rows = """[{"id":"active","title":"Fixture active plan"},{"id":"dismissed","title":"Fixture dismissed plan","status":"cancelled"}]"""

    @Before fun blockNetwork() {
        val mock = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val body = when {
                request.url.encodedPath.endsWith("/agent/plans") -> "{\"plans\":$rows,\"hasMore\":false}"
                request.url.encodedPath.endsWith("/members") -> "[]"
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200)
                .message("fixture").body(body.toResponseBody(Http.jsonMedia)).build()
        }.build()
        for (name in listOf("client", "chatClient")) {
            val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
            originals[name] = field.get(null) as OkHttpClient
            field.set(null, mock)
        }
        plans = PlansStore("synthetic-no-credentials")
    }
    @After fun restoreNetwork() {
        for ((name, client) in originals) Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client)
    }
    private fun render() {
        runBlocking { plans.use("synthetic-team") }
        Assert.assertEquals(PlansStore.Phase.Loaded, plans.phase)
        val store = AgentStore("synthetic-no-credentials", compose.activity)
        compose.runOnIdle {
            compose.activity.setContent {
                NuphosTheme {
                    CompositionLocalProvider(LocalAgentStore provides store, LocalPlansStore provides plans) {
                        PlansPage(true, {}, rememberNavController())
                    }
                }
            }
        }
    }
    @Test fun unmatchedSearchCanClearWithoutShowingDismissed() {
        render()
        compose.runOnIdle { plans.search = "missing fixture" }
        compose.onNodeWithText("No matching plans").assertIsDisplayed()
        compose.onNodeWithText("Clear search").performClick()
        compose.onNodeWithText("Fixture active plan").assertIsDisplayed()
        compose.onNodeWithText("Fixture dismissed plan").assertDoesNotExist()
        Assert.assertFalse(plans.showDismissed)
    }
    @Test fun dismissedOnlyOffersShowDismissed() {
        rows = """[{"id":"dismissed","title":"Fixture dismissed plan","status":"cancelled"}]"""
        render()
        compose.onNodeWithText("Dismissed plans are hidden.").assertIsDisplayed()
        compose.onNodeWithText("Show dismissed").performClick()
        compose.onNodeWithText("Fixture dismissed plan").assertIsDisplayed()
    }
    @Test fun emptyPlansOfferPlanningPrompt() {
        rows = "[]"
        render()
        compose.onNodeWithText("Ask the agent to plan a change").assertIsDisplayed()
        compose.onNodeWithText("Clear search").assertDoesNotExist()
        compose.runOnIdle { plans.search = "missing fixture" }
        compose.onNodeWithText("Ask the agent to plan a change").assertIsDisplayed()
    }
    @Test fun searchStillIncludesMatchingDismissedPlans() {
        render()
        compose.runOnIdle { plans.search = "dismissed" }
        compose.onNodeWithText("Fixture dismissed plan").assertIsDisplayed()
        Assert.assertFalse(plans.showDismissed)
    }
}
