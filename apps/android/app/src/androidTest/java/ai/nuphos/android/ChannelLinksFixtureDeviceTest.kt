package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.NuphosWeb
import ai.nuphos.android.data.TokenStore
import ai.nuphos.android.model.Team
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.session.ConversationLink
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.chat.ConversationScreen
import ai.nuphos.android.ui.theme.NuphosTheme
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Synthetic chat only: a link in a chat's post goes where the same link in a Task goes. The chat is opened
 * the way the app opens one, through the conversation route. Never touches a live API.
 */
@RunWith(AndroidJUnit4::class)
class ChannelLinksFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val token = "synthetic-chat-links"
    private val team = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private val web = "https://example.test/release-notes"
    private val plan = "https://nuphos.ai/teams/${team.id}/plans/plan-1"
    private val conversation get() = "${NuphosWeb.SITE_URL}/teams/${team.id}/agent/other-chat"
    private val opened = CopyOnWriteArrayList<String>()
    private lateinit var store: AgentStore
    private lateinit var auth: AuthSession
    private lateinit var tokens: TokenStore
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
    private val app get() = inst.targetContext.applicationContext as NuphosApplication
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    private fun post(id: Int, text: String) =
        """{"id":"p$id","role":"user","metadata":{"version":1,"sender":{"type":"agent","id":"agent-ops","displayName":"Release ops"},"sentAt":"2026-11-03T09:0$id:00Z","sourceSessionId":"agent-ops"},"parts":[{"type":"text","text":"$text"}]}"""
    private fun detail(): String {
        val posts = listOf(
            post(1, "Read [the release notes]($web) first."),
            post(2, "The rollout follows [the plan]($plan)."),
            post(3, "It came up in [the other chat]($conversation)."),
        ).joinToString(",")
        return """{"kind":"channel","title":"chat-a","transcriptUpdatedAt":"t3","messageCount":3,"activitySeq":3,"messages":[$posts]}"""
    }

    @Before fun before() {
        val target = inst.targetContext
        val context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chat-links-fixture", mode)
        }
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            val body = when {
                path.endsWith("/agent/conversations/chat-a") -> detail()
                path.endsWith("/agent/conversations/agent-ops") -> """{"sessionId":"agent-ops","title":"Release ops","isOwner":true,"messages":[]}"""
                path.endsWith("/agents") -> """{"agents":[{"sessionId":"agent-ops","title":"Release ops"}]}"""
                path.endsWith("/agent/conversations") -> """{"conversations":[],"hasMore":false}"""
                path.endsWith("/read") -> """{"activitySeq":3,"readSeq":3,"unread":false}"""
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build())
        val authContext = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chat_links_fixture_$name", mode)
        }
        tokens = TokenStore(authContext)
        inst.runOnMainSync {
            savedAccess = access().value
            auth = AuthSession(app, tokens); auth.signOut()
            AiAccess.activate(token); AiAccess.grant(token)
            store = AgentStore(token, context)
            store.acceptMemberships(listOf(team), team.id)
            app.conversationLinks.clear()
        }
    }

    @After fun after() {
        inst.runOnMainSync {
            app.conversationLinks.clear()
            if (::store.isInitialized) store.disposeForConsent()
            if (::auth.isInitialized) auth.signOut()
            access().value = savedAccess
        }
        if (::tokens.isInitialized) tokens.clear()
        Http::class.java.getDeclaredField("client").also { it.isAccessible = true }.set(null, original)
    }

    private fun render() {
        val browser = object : UriHandler { override fun openUri(uri: String) { opened += uri } }
        compose.setContent {
            NuphosTheme(darkTheme = InstrumentationRegistry.getArguments().getString("darkTheme") == "true") {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth, LocalUriHandler provides browser) {
                    val nav = rememberNavController()
                    NavHost(nav, startDestination = "conversation/chat-a") {
                        composable("conversation/{id}") { entry ->
                            ConversationScreen(entry.arguments!!.getString("id")!!, fresh = false,
                                onBack = { fail("The chat closed itself") }, nav = nav)
                        }
                        composable("plan/{id}") { entry -> Text("Plan page ${entry.arguments!!.getString("id")}") }
                    }
                }
            }
        }
        compose.waitUntil(8_000) { compose.onAllNodesWithText("the release notes", substring = true).fetchSemanticsNodes().isNotEmpty() }
    }

    /** Taps the link's own glyphs, not the post around them. */
    private fun tap(link: String) {
        val node = compose.onNodeWithText(link, substring = true, useUnmergedTree = true)
        val layouts = mutableListOf<TextLayoutResult>()
        node.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { assertTrue(it(layouts)) }
        val layout = layouts.single()
        val glyph = layout.getBoundingBox(layout.layoutInput.text.text.indexOf(link) + 1)
        node.performTouchInput { click(Offset(glyph.center.x, glyph.center.y)) }
        compose.waitForIdle()
    }

    @Test fun aWebLinkInAPostOpensInTheBrowser() {
        render()
        tap("the release notes")
        compose.runOnIdle { assertEquals(listOf(web), opened.toList()) }
    }

    @Test fun aPlanLinkInAPostOpensThePlan() {
        render()
        tap("the plan")
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Plan page plan-1").fetchSemanticsNodes().isNotEmpty() }
        assertTrue(opened.isEmpty())
    }

    @Test fun aConversationLinkInAPostOpensItInTheApp() {
        render()
        tap("the other chat")
        compose.waitUntil(5_000) { app.conversationLinks.value.value != null }
        assertEquals(ConversationLink.parse(conversation), app.conversationLinks.value.value?.destination)
        assertTrue(opened.isEmpty())
    }
}
