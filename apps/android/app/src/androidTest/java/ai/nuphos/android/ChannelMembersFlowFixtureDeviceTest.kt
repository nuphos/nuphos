package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
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
import ai.nuphos.android.ui.chats.ChannelScreen
import ai.nuphos.android.ui.chats.ChatsPage
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.runBlocking
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
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Synthetic chats only (#5313): a group chat's title opens its Members, and leaving goes back to the
 * Bots list, which says so. Never touches a live API.
 */
@RunWith(AndroidJUnit4::class)
class ChannelMembersFlowFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val token = "synthetic-channel-members"
    private val team = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Acme Inc.")
    private val writes = CopyOnWriteArrayList<String>()
    @Volatile private var left = false
    private lateinit var store: AgentStore
    private lateinit var auth: AuthSession
    private lateinit var tokens: TokenStore
    private lateinit var nav: NavHostController
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    private fun post(id: String, sender: String, name: String, minute: Int, text: String, agent: Boolean = false) =
        """{"id":"$id","role":"user","metadata":{"version":1,"sender":{"type":"${if (agent) "agent" else "user"}","id":"$sender","displayName":"$name"},""" +
            """"sentAt":"2026-11-03T17:${minute.toString().padStart(2, '0')}:00Z"${if (agent) ""","sourceSessionId":"$sender"""" else ""}},"parts":[{"type":"text","text":"$text"}]}"""
    private val faces = """[{"id":"bot-planner","name":"Launch planner","agent":{"avatar":"01-vermeer-girl"}},{"id":"riley","name":"Riley Chen"}]"""
    private val detail = """{"kind":"channel","title":"Launch review","transcriptUpdatedAt":"t3","messageCount":3,"activitySeq":3,"readSeq":3,"faces":$faces,"messages":[""" +
        listOf(post("p1", "riley", "Riley Chen", 50, "Can we ship the pricing page on Thursday?"),
            post("p2", "bot-planner", "Launch planner", 52, "Thursday works. Copy is final; I still need the hero image from Design Critic.", agent = true),
            post("p3", "jordan", "Jordan Lee", 54, "Let’s ask Support Lead to check the FAQ too.")).joinToString(",") + "]}"
    private val participants = """{"generalAccess":"none","participants":[""" +
        """{"id":"jordan","name":"Jordan Lee","email":"jordan@acme.example","isOwner":true,"role":"owner"},""" +
        """{"id":"riley","name":"Riley Chen","email":"riley@acme.example","isOwner":false,"role":"reply"},""" +
        """{"id":"sam","name":"Sam Park","email":"sam@acme.example","isOwner":false,"role":"reply"}]}"""
    private fun chat(id: String, title: String, avatar: String, at: String, text: String, from: String? = null) =
        """{"sessionId":"$id","teamId":"${team.id}","title":"$title","kind":"channel","lastActiveAt":"2026-11-03T$at:00Z",""" +
            """"faces":[{"id":"bot-$id","name":"$title","agent":{"avatar":"$avatar"}}],"lastMessage":{"text":"$text"${from?.let { ""","from":"$it"""" } ?: ""}}}"""
    private val group = """{"sessionId":"chat-launch","teamId":"${team.id}","title":"Launch review","kind":"channel","lastActiveAt":"2026-11-03T17:54:00Z","faces":$faces,"lastMessage":{"text":"Let’s ask Support Lead to check the FAQ too."}}"""
    private val others = listOf(chat("chat-planner", "Launch planner", "01-vermeer-girl", "17:55", "Thursday works. Copy is final."),
        chat("chat-critic", "Design Critic", "07-ada", "17:42", "I would keep the larger headline."),
        chat("chat-support", "Support Lead", "05-rembrandt", "17:10", "Three tickets mention the export."),
        chat("chat-docs", "Docs Writer", "09-frida", "15:12", "The migration guide now covers it."))

    @Before fun before() {
        val target = inst.targetContext
        val context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("channel-members-fixture", mode)
        }
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            if (request.method != "GET") writes += "${request.method} $path"
            val body = when {
                request.method == "DELETE" && path.endsWith("/agent/conversations/chat-launch/participants/jordan") -> {
                    left = true
                    participants.replace(""""id":"jordan","name":"Jordan Lee","email":"jordan@acme.example","isOwner":true,"role":"owner"},""", "")
                }
                path.endsWith("/agent/conversations/chat-launch/participants") -> participants
                path.endsWith("/agent/conversations/chat-launch/agents") ->
                    """{"agents":[{"sessionId":"bot-planner","title":"Launch planner","ownerId":"jordan","avatar":"01-vermeer-girl","presence":{"state":"online"}},""" +
                        """{"sessionId":"bot-critic","title":"Design Critic","ownerId":"riley","avatar":"07-ada","presence":{"state":"online"}}]}"""
                path.endsWith("/agent/conversations/chat-launch") -> detail
                path.endsWith("/agent-runtimes") -> """{"runtimes":[{"id":"r1","provider":"codex","label":"Synthetic runtime","status":"active","kind":"managed"}]}"""
                path.endsWith("/ai-consent") -> """{"version":"${ai.nuphos.android.data.AccountApi.AI_CONSENT_VERSION}","accepted":true}"""
                path.endsWith("/auth/me") -> """{"id":"jordan","email":"jordan@acme.example","name":"Jordan Lee"}"""
                path.endsWith("/agent/conversations") && request.url.queryParameter("kind") == "channel" ->
                    if (request.url.queryParameter("scope") == "mine") (if (left) others else listOf(group) + others)
                        .joinToString(",", """{"conversations":[""", """],"hasMore":false}""")
                    else """{"conversations":[],"hasMore":false}"""
                path.endsWith("/agent/conversations") -> """{"conversations":[],"hasMore":false}"""
                path.endsWith("/read") -> """{"activitySeq":3,"readSeq":3,"unread":false}"""
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("fixture")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build()
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, client)
        val app = target.applicationContext as NuphosApplication
        val authContext = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("channel_members_fixture_$name", mode)
        }
        tokens = TokenStore(authContext)
        tokens.write(token)
        inst.runOnMainSync {
            savedAccess = access().value
            // Signed in through the app's own restore, since leaving needs the viewer's id.
            auth = AuthSession(app, tokens); auth.restore()
        }
        var ready = false
        repeat(100) { if (!ready) { inst.runOnMainSync { ready = auth.user != null && auth.aiAllowed }; Thread.sleep(50) } }
        assertTrue("The synthetic sign-in did not finish", ready)
        inst.runOnMainSync {
            store = AgentStore(token, context)
            store.acceptMemberships(listOf(team), team.id)
        }
        runBlocking { store.loadChannels() }
    }

    @After fun after() {
        inst.runOnMainSync {
            if (::store.isInitialized) store.disposeForConsent()
            if (::auth.isInitialized) auth.signOut()
            access().value = savedAccess
        }
        if (::tokens.isInitialized) tokens.clear()
        if (::original.isInitialized) Http::class.java.getDeclaredField("client").also { it.isAccessible = true }.set(null, original)
    }

    private fun has(text: String) = compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()

    /** Waits, and on a timeout says what was on screen. */
    private fun settle(what: String, condition: () -> Boolean) {
        try { compose.waitUntil(10_000, condition) } catch (e: androidx.compose.ui.test.ComposeTimeoutException) {
            capture("failed")
            val roots = compose.onAllNodes(isRoot())
            val tree = (0 until roots.fetchSemanticsNodes().size).joinToString("\n") { roots[it].printToString() }
            throw AssertionError("Timed out waiting for $what; writes=$writes\n$tree", e)
        }
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        Thread.sleep(800)
        val bitmap = inst.uiAutomation.takeScreenshot() ?: return
        val dir = File(inst.targetContext.applicationContext.externalMediaDirs.first(), "additional_test_output").apply { mkdirs() }
        File(dir, "members-$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }

    @Test fun theTitleOpensMembersAndLeavingGoesBackToTheBotsList() {
        compose.setContent {
            NuphosTheme(darkTheme = false) {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    nav = rememberNavController()
                    NavHost(nav, startDestination = "bots") {
                        composable("bots") { ChatsPage(nav, showCreateButton = false) }
                        composable("channel/{id}") { entry ->
                            ChannelScreen(entry.arguments?.getString("id").orEmpty(), onBack = { nav.popBackStack() }, onLink = {})
                        }
                    }
                }
            }
        }
        compose.waitUntil(10_000) { has("Launch review") }
        compose.runOnUiThread { nav.navigate("channel/chat-launch") }
        compose.waitUntil(10_000) { has("Can we ship the pricing page on Thursday?") }
        capture("A1")
        // A group chat's title opens its Members, with its people from the chat's sharing.
        compose.onNodeWithTag("chat-title").performClick()
        compose.waitUntil(10_000) { has("Jordan Lee (you)") }
        compose.onNodeWithText("Members").assertIsDisplayed()
        compose.onNodeWithText("Leave chat").performClick()
        compose.onNodeWithText("Riley Chen becomes the owner. You can come back only if someone adds you.").assertIsDisplayed()
        compose.onNodeWithText("Leave").performClick()
        // Back on the Bots list, which says so; the chat is gone from it.
        settle("the leave request") { writes.contains("DELETE /agent/conversations/chat-launch/participants/jordan") }
        settle("the snackbar") { has("You left “Launch review”") }
        settle("the chat gone from the list") { !has("Launch review") }
        capture("A7")
    }
}
