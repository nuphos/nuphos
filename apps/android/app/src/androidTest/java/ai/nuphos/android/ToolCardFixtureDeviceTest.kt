package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.TokenStore
import ai.nuphos.android.model.Team
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.chat.ConversationScreen
import ai.nuphos.android.ui.chats.ChannelScreen
import ai.nuphos.android.ui.theme.NuphosTheme
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * What render_artifact and render_chart made shows as cards that open over the chat, in a Task
 * and in a Bot's chat, whose posts never carry the Bot's tool calls (#5272). Synthetic data only.
 */
@RunWith(AndroidJUnit4::class)
class ToolCardFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val token = "synthetic-tool-cards"
    private val team = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private lateinit var store: AgentStore
    private lateinit var auth: AuthSession
    private lateinit var tokens: TokenStore
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
    /** The viewer is in the chat but does not own the Bot and cannot read its Task. */
    @Volatile private var stranger = false
    /** The Bot is still getting started, as a new customer's Bot is in its first chat. */
    @Volatile private var onboarding = false
    private val reply = "I opened the itinerary and the budget chart beside the chat."
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    private val chat = """{"sessionId":"chat-trip","kind":"channel","title":"Trip planner","isOwner":true,"transcriptUpdatedAt":"t","messageCount":2,"activitySeq":2,"readSeq":2,
        "faces":[{"id":"bot-trip","name":"Trip planner","agent":{"avatar":"05-rembrandt"}}],"messages":[
        {"id":"u","role":"user","metadata":{"version":1,"sender":{"type":"user","id":"viewer","displayName":"Preview User"},"sentAt":"2026-11-08T09:55:00Z"},"parts":[{"type":"text","text":"Make me an itinerary page and a budget chart."}]},
        {"id":"a","role":"user","metadata":{"version":1,"sender":{"type":"agent","id":"bot-trip","displayName":"Trip planner"},"sourceSessionId":"bot-trip","sentAt":"2026-11-08T09:56:00Z"},"parts":[{"type":"text","text":"$reply"}]}]}"""
    private val chart = """{"type":"bar","title":"Trip budget (EUR)","xKey":"item","series":[{"key":"eur","label":"EUR"}],"data":[{"item":"Hotel","eur":240},{"item":"Food","eur":120},{"item":"Transit","eur":40}]}"""
    private val bot get() = """{"sessionId":"bot-trip","title":"Trip planner","avatar":"05-rembrandt","isOwner":true,"canManage":true,"readOnly":false${onboarding()},"messages":[
        {"id":"t-u","role":"user","parts":[{"type":"text","text":"Make me an itinerary page and a budget chart."}]},
        {"id":"t-a","role":"assistant","parts":[
          {"type":"tool-render_artifact","toolCallId":"t-art","state":"output-available","completedAt":1794131730000,
           "input":{"label":"Show the itinerary","artifactId":"lisbon-itinerary","title":"Lisbon itinerary","kind":"html",
             "content":"<!doctype html><html><body><h1>Lisbon, two days</h1><p>Day 1: Alfama and the castle. Day 2: Belem and LX Factory.</p></body></html>"},
           "output":{"artifactId":"lisbon-itinerary","title":"Lisbon itinerary","kind":"html","shown":"The artifact is open beside the chat."}},
          {"type":"tool-render_chart","toolCallId":"t-chart","state":"output-available","completedAt":1794131731000,"input":$chart,"output":$chart},
          {"type":"text","text":"$reply"}]}],
        "runtimeState":{"schemaVersion":2,"state":"idle","phase":"idle","actions":{"send":true}}}"""

    private fun onboarding() = if (onboarding) ""","botOnboarding":"active"""" else ""

    @Before fun before() {
        val target = inst.targetContext
        val context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("tool-card-fixture", mode)
        }
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            if (stranger && path.endsWith("/agent/conversations/bot-trip")) return@addInterceptor Response.Builder().request(request)
                .protocol(Protocol.HTTP_1_1).code(403).message("fixture").body("""{"error":{"message":"Session access denied"}}""".toResponseBody(Http.jsonMedia)).build()
            val body = when {
                path.endsWith("/agent/conversations/chat-trip") -> chat
                path.endsWith("/agent/conversations/bot-trip") -> bot
                path.endsWith("/agents") -> """{"agents":[{"sessionId":"bot-trip","title":"Trip planner","avatar":"05-rembrandt","ownerId":"${if (stranger) "another-viewer" else "viewer"}"}]}"""
                path.endsWith("/ai-consent") -> """{"version":"${ai.nuphos.android.data.AccountApi.AI_CONSENT_VERSION}","accepted":true}"""
                path.endsWith("/auth/me") -> """{"id":"viewer","email":"viewer@example.com","name":"Preview User"}"""
                path.endsWith("/agent/conversations") && request.url.queryParameter("bots") == "true" ->
                    """{"conversations":[{"sessionId":"bot-trip","title":"Trip planner","avatar":"05-rembrandt","isOwner":true${onboarding()}}],"hasMore":false}"""
                path.endsWith("/agent/conversations") -> """{"conversations":[],"hasMore":false}"""
                path.endsWith("/agent/triggers") -> "[]"
                path.endsWith("/resources") -> """{"resources":[]}"""
                path.endsWith("/read") -> """{"activitySeq":2,"readSeq":2,"unread":false}"""
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build())
        val app = target.applicationContext as NuphosApplication
        val authContext = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("tool_card_fixture_$name", mode)
        }
        tokens = TokenStore(authContext)
        tokens.write(token)
        inst.runOnMainSync { savedAccess = access().value; auth = AuthSession(app, tokens); auth.restore() }
        var ready = false
        repeat(100) { if (!ready) { inst.runOnMainSync { ready = auth.user != null && auth.aiAllowed }; Thread.sleep(50) } }
        assertTrue("The synthetic sign-in did not finish", ready)
        inst.runOnMainSync { store = AgentStore(token, context); store.acceptMemberships(listOf(team), team.id) }
    }

    @After fun after() {
        inst.runOnMainSync {
            if (::store.isInitialized) store.disposeForConsent()
            if (::auth.isInitialized) auth.signOut()
            access().value = savedAccess
        }
        if (::tokens.isInitialized) tokens.clear()
        Http::class.java.getDeclaredField("client").also { it.isAccessible = true }.set(null, original)
    }

    private fun render(task: Boolean) {
        compose.setContent {
            NuphosTheme(darkTheme = false) {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    if (task) ConversationScreen("bot-trip", fresh = false, onBack = {}, nav = rememberNavController())
                    else ChannelScreen("chat-trip", onBack = {}, onLink = {})
                }
            }
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithText(reply).fetchSemanticsNodes().isNotEmpty() }
    }

    private fun assertCardsOpen(name: String) {
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("artifact-card").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("chart-card").assertExists("The chart has no card")
        compose.onNodeWithText("Lisbon itinerary").assertExists()
        compose.onNodeWithText("Trip budget (EUR)").assertExists()
        capture("$name-cards")

        compose.onNodeWithTag("artifact-card").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("artifact-page").fetchSemanticsNodes().isNotEmpty() }
        Thread.sleep(1500) // the page draws in the WebView
        capture("$name-artifact-open")
        compose.onNodeWithTag("tool-card-close").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("tool-card-panel").fetchSemanticsNodes().isEmpty() }

        compose.onNodeWithTag("chart-card").performClick()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("tool-card-panel").fetchSemanticsNodes().isNotEmpty() }
        capture("$name-chart-open")
        compose.onNodeWithTag("tool-card-close").performClick()
    }

    @Test fun aTasksArtifactAndChartAreCards() {
        render(task = true)
        assertCardsOpen("tool-cards-task")
    }

    @Test fun aBotsChatShowsWhatTheBotMade() {
        render(task = false)
        assertCardsOpen("tool-cards-bot")
    }

    /** A new customer's first chat is with a Bot still getting started: what it made shows all the same. */
    @Test fun aBotStillGettingStartedShowsWhatItMade() {
        onboarding = true
        inst.runOnMainSync { store.refresh() }
        render(task = false)
        assertCardsOpen("tool-cards-bot-onboarding")
    }

    @Test fun aViewerWhoCannotOpenTheBotsTaskSeesNoCards() {
        stranger = true
        render(task = false)
        Thread.sleep(1500)
        compose.onNodeWithTag("artifact-card").assertDoesNotExist()
        compose.onNodeWithTag("chart-card").assertDoesNotExist()
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        Thread.sleep(500)
        val output = File(inst.targetContext.externalMediaDirs.first(), "additional_test_output").apply { mkdirs() }
        val bitmap = inst.uiAutomation.takeScreenshot() ?: error("Screenshot unavailable")
        File(output, "$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    }
}
