package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Synthetic chats only: chat A's first read is left hanging, B opens, then A again. Never touches a live API. */
@RunWith(AndroidJUnit4::class)
class ChannelReopenFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val token = "synthetic-chats-reopen"
    private val team = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private val aReads = AtomicInteger()
    private val aStarted = CountDownLatch(1)
    private val releaseA = CountDownLatch(1)
    private lateinit var store: AgentStore
    private lateinit var auth: AuthSession
    private lateinit var tokens: TokenStore
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    private fun detail(chat: String, text: String) =
        """{"kind":"channel","title":"$chat","transcriptUpdatedAt":"t-$chat","messageCount":1,"messages":[""" +
            """{"id":"$chat-1","role":"user","metadata":{"version":1,"sender":{"type":"user","id":"diana","displayName":"Diana Prince"},""" +
            """"sentAt":"2026-11-03T09:00:00Z"},"parts":[{"type":"text","text":"$text"}]}]}"""

    @Before fun before() {
        val target = inst.targetContext
        val context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chats-reopen-fixture", mode)
        }
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            val body = when {
                path.endsWith("/agent/conversations/chat-a") -> {
                    // The first read of A hangs until the reader has moved on to B.
                    if (aReads.incrementAndGet() == 1) { aStarted.countDown(); releaseA.await(10, TimeUnit.SECONDS) }
                    detail("chat-a", "Only in chat A")
                }
                path.endsWith("/agent/conversations/chat-b") -> detail("chat-b", "Only in chat B")
                path.endsWith("/agents") -> """{"agents":[]}"""
                else -> """{"conversations":[],"hasMore":false}"""
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build())
        val app = target.applicationContext as NuphosApplication
        val authContext = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chats_reopen_fixture_$name", mode)
        }
        tokens = TokenStore(authContext)
        inst.runOnMainSync {
            savedAccess = access().value
            // Signed out first: signing out revokes AI access, which the chat then needs.
            auth = AuthSession(app, tokens); auth.signOut()
            AiAccess.activate(token); AiAccess.grant(token)
            store = AgentStore(token, context)
            store.acceptMemberships(listOf(team), team.id)
        }
    }

    @After fun after() {
        releaseA.countDown()
        inst.runOnMainSync {
            if (::store.isInitialized) store.disposeForConsent()
            if (::auth.isInitialized) auth.signOut()
            access().value = savedAccess
        }
        if (::tokens.isInitialized) tokens.clear()
        Http::class.java.getDeclaredField("client").also { it.isAccessible = true }.set(null, original)
    }

    private fun shows(text: String) = compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()

    @Test fun aChatLeftWhileLoadingLoadsAgainWithoutMixingAnother() {
        val open = mutableStateOf("chat-a")
        compose.setContent {
            NuphosTheme {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    ChannelScreen(open.value, onBack = { fail("A chat closed itself") })
                }
            }
        }
        assertTrue("A's first read started", aStarted.await(5, TimeUnit.SECONDS))
        // Leave A while its first read is still out, and open B.
        compose.runOnIdle { open.value = "chat-b" }
        compose.waitUntil(5_000) { shows("Only in chat B") }
        compose.onNodeWithText("Only in chat A").assertDoesNotExist()
        // A's abandoned read finishing late changes nothing in B.
        releaseA.countDown()
        Thread.sleep(600); compose.waitForIdle()
        compose.onNodeWithText("Only in chat B").assertIsDisplayed()
        compose.onNodeWithText("Only in chat A").assertDoesNotExist()
        // Back in A: it loads again, shows only its own post and no error.
        compose.runOnIdle { open.value = "chat-a" }
        compose.waitUntil(5_000) { shows("Only in chat A") }
        compose.onNodeWithText("Only in chat B").assertDoesNotExist()
        compose.onNodeWithText("Try again").assertDoesNotExist()
        assertTrue("A was read again after its first read was abandoned", aReads.get() >= 2)
    }
}
