package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
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
import ai.nuphos.android.ui.chats.ChannelScreen
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
import java.util.concurrent.atomic.AtomicInteger

/** Synthetic chat only: an agent's dots follow its turn, and its reply arrives as they end. Never touches a live API. */
@RunWith(AndroidJUnit4::class)
class ChannelTypingFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val token = "synthetic-chats-typing"
    private val team = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private val listings = AtomicInteger()
    private val reads = CopyOnWriteArrayList<Int>()
    @Volatile private var messages = 1
    @Volatile private var running = false
    private lateinit var store: AgentStore
    private lateinit var auth: AuthSession
    private lateinit var tokens: TokenStore
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    private fun detail(): String {
        val posts = (1..messages).joinToString(",") {
            """{"id":"p$it","role":"user","metadata":{"version":1,"sender":{"type":"agent","id":"agent-ops","displayName":"Release ops"},"sentAt":"2026-11-03T09:0$it:00Z","sourceSessionId":"agent-ops"},"parts":[{"type":"text","text":"Post $it"}]}"""
        }
        return """{"kind":"channel","title":"chat-a","transcriptUpdatedAt":"t$messages","messageCount":$messages,"activitySeq":$messages,"messages":[$posts]}"""
    }
    private fun agents(): String {
        val run = if (running) ""","activeRun":{"streamId":"run-1"}""" else ""
        return """{"conversations":[{"sessionId":"agent-ops","teamId":"${team.id}","title":"Release ops","lastActiveAt":"2026-11-03T09:00:00Z","isOwner":true$run}],"hasMore":false}"""
    }

    @Before fun before() {
        val target = inst.targetContext
        val context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chats-typing-fixture", mode)
        }
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            val body = when {
                path.endsWith("/agent/conversations/chat-a") -> { reads += messages; detail() }
                path.endsWith("/agents") -> """{"agents":[{"sessionId":"agent-ops","title":"Release ops"}]}"""
                path.endsWith("/agent/conversations") && request.url.queryParameter("kind") == null -> { listings.incrementAndGet(); agents() }
                path.endsWith("/agent/conversations") -> """{"conversations":[],"hasMore":false}"""
                path.endsWith("/read") -> """{"activitySeq":1,"readSeq":1,"unread":false}"""
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build())
        val app = target.applicationContext as NuphosApplication
        val authContext = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chats_typing_fixture_$name", mode)
        }
        tokens = TokenStore(authContext)
        inst.runOnMainSync {
            savedAccess = access().value
            auth = AuthSession(app, tokens); auth.signOut()
            AiAccess.activate(token); AiAccess.grant(token)
            store = AgentStore(token, context)
            store.acceptMemberships(listOf(team), team.id)
        }
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

    private fun render() {
        compose.setContent {
            NuphosTheme {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    ChannelScreen("chat-a", onBack = { fail("The chat closed itself") })
                }
            }
        }
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Post 1").fetchSemanticsNodes().isNotEmpty() }
    }
    private val dots = hasContentDescription("Release ops is typing")
    private fun showing() = compose.onAllNodes(dots).fetchSemanticsNodes().isNotEmpty()

    @Test fun dotsFollowATurnThatStartsWhileTheChatIsOpen() {
        render()
        assertFalse(showing())
        running = true
        compose.waitUntil(8_000) { showing() }
        // A post during the turn shows while the dots keep going: the agent is still working.
        messages = 2
        compose.waitUntil(8_000) { compose.onAllNodesWithText("Post 2").fetchSemanticsNodes().isNotEmpty() }
        assertTrue(showing())
    }

    @Test fun theReplyArrivesAsTheDotsEndNeverAfter() {
        running = true
        render()
        compose.waitUntil(8_000) { showing() }
        // The agent posts, then its turn ends.
        messages = 2; running = false
        compose.waitUntil(8_000) { !showing() }
        compose.onNodeWithText("Post 2").assertExists()
    }

    @Test fun checksStopWhileStopped() {
        render()
        compose.waitUntil(8_000) { listings.get() >= 1 }
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        Thread.sleep(1_000)
        val stopped = listings.get()
        Thread.sleep(7_000)
        assertEquals("No checks while stopped", stopped, listings.get())
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        compose.waitUntil(8_000) { listings.get() > stopped }
    }
}
