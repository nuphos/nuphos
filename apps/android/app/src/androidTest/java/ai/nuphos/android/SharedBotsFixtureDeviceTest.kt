package ai.nuphos.android

import android.content.ContextWrapper
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.model.BotFaces
import ai.nuphos.android.model.Team
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.chats.ChatsPage
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.cancel
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * A Bot someone else owns and shared with the viewer is listed in Bots, as on
 * Desktop, with its own face (#3852). The server returns it only for `scope=shared`.
 */
@RunWith(AndroidJUnit4::class)
class SharedBotsFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val token = "synthetic-shared-bots"
    private val team = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private val originals = mutableMapOf<String, OkHttpClient>()
    private lateinit var store: AgentStore
    private var auth: ai.nuphos.android.session.AuthSession? = null
    private var savedAccess: Any? = null

    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    private fun bot(id: String, title: String, at: String) =
        """{"sessionId":"$id","title":"$title","avatar":"07-ada","agentRuntime":"codex","lastActiveAt":"$at"}"""
    private val own = bot("bot-own", "Own Bot", "2026-11-03T09:00:00Z")
    private val shared = bot("bot-shared", "Shared Bot", "2026-11-03T09:10:00Z")

    @Before fun before() {
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        val context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("shared-bots-fixture", mode)
        }
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            val scope = request.url.queryParameter("scope")
            val body = when {
                path.endsWith("/agent-runtimes") ->
                    """{"runtimes":[{"id":"r1","provider":"codex","label":"Synthetic runtime","status":"active","kind":"managed"}]}"""
                path == "/agent/conversations" && request.url.queryParameter("kind") == "channel" -> """{"conversations":[],"hasMore":false}"""
                // One's own Bot is in the history (mine); the shared one only in scope=shared.
                path == "/agent/conversations" && scope == "shared" ->
                    if (request.url.queryParameter("bots") == "true") """{"conversations":[$shared],"hasMore":false}"""
                    else """{"conversations":[],"hasMore":false}"""
                path == "/agent/conversations" -> """{"conversations":[$own],"hasMore":false}"""
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build()
        for (name in listOf("client", "chatClient")) {
            val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
            originals[name] = field.get(null) as OkHttpClient
            field.set(null, client)
        }
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            savedAccess = access().value
            AiAccess.activate(token); AiAccess.grant(token)
            store = AgentStore(token, context)
            store.acceptMemberships(listOf(team), team.id)
        }
    }

    @After fun after() {
        auth?.let { (ai.nuphos.android.session.AuthSession::class.java.getDeclaredField("scope").also { f -> f.isAccessible = true }
            .get(it) as kotlinx.coroutines.CoroutineScope).cancel() }
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            if (::store.isInitialized) store.disposeForConsent()
            access().value = savedAccess
        }
        originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
    }

    @Test fun aBotSharedWithYouIsListedWithItsFace() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
        val auth = ai.nuphos.android.session.AuthSession(app, app.tokenStore).also { auth = it }
        ai.nuphos.android.session.AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
        @Suppress("UNCHECKED_CAST") (ai.nuphos.android.session.AuthSession::class.java.getDeclaredField("state\$delegate")
            .also { it.isAccessible = true }.get(auth) as MutableState<Any>).value =
            ai.nuphos.android.session.AuthSession.State.SignedIn(ai.nuphos.android.model.NuphosUser.preview)
        compose.setContent {
            NuphosTheme { CompositionLocalProvider(LocalAgentStore provides store, ai.nuphos.android.ui.LocalAuthSession provides auth) {
                val nav = rememberNavController()
                NavHost(nav, startDestination = "list") { composable("list") { ChatsPage(nav) } }
            } }
        }
        compose.runOnIdle { store.refresh() }
        compose.waitUntil(8_000) { compose.onAllNodesWithTag("chat-row:bot-own").fetchSemanticsNodes().isNotEmpty() }
        capture("shared-bots.png")
        compose.waitUntil(8_000) { compose.onAllNodesWithTag("chat-row:bot-shared").fetchSemanticsNodes().isNotEmpty() }
        // Its row wears the Bot's face, not the runtime mark, like one's own.
        assertEquals("07-ada", BotFaces.face("bot-shared"))
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        val inst = InstrumentationRegistry.getInstrumentation()
        inst.waitForIdleSync()
        android.os.SystemClock.sleep(1500)
        File(inst.targetContext.getExternalFilesDir(null), name).outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }
}
