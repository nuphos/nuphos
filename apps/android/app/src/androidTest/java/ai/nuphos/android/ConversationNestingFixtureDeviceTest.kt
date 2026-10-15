package ai.nuphos.android

import android.content.Context
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.*
import ai.nuphos.android.model.*
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.*
import ai.nuphos.android.ui.agent.AgentPage
import ai.nuphos.android.ui.chat.ConversationScreen
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Synthetic local transport only. The outer rule blocks the real Activity's reads. */
@RunWith(AndroidJUnit4::class)
class ConversationNestingFixtureDeviceTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val requests = CopyOnWriteArrayList<Request>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private val token = "pins-fixture-no-credentials"
    private lateinit var store: AgentStore
    private lateinit var app: NuphosApplication
    private var savedAccess: Any? = null
    private var savedAuth: Any? = null
    private var savedAuthToken: String? = null
    private var preferences: Map<String, *> = emptyMap<String, Any>()
    @Volatile private var owner = true
    @Volatile private var emptyHistory = false
    @Volatile private var failFavorites = false
    @Volatile private var holdNextA = false
    private val held = CountDownLatch(1)
    private val release = CountDownLatch(1)
    @Volatile private var entries = """[{"key":"agent-session:normal","label":"Synthetic pin"}]"""
    private var revision = 1
    @Suppress("UNCHECKED_CAST") private fun state(target: Any, name: String, delegated: Boolean = true) =
        target.javaClass.getDeclaredField(name + if (delegated) "\$delegate" else "").also { it.isAccessible = true }.get(target) as MutableState<Any?>

    private val network = object : ExternalResource() {
        override fun before() {
            app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
            preferences = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).all.toMap()
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                savedAccess = state(AiAccess, "state", false).value
                savedAuth = state(app.authSession, "state").value
                val tokenField = AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }
                savedAuthToken = tokenField.get(app.authSession) as String?
                tokenField.set(app.authSession, token)
                state(app.authSession, "state").value = AuthSession.State.SignedIn(NuphosUser("pins-fixture", "pins@example.invalid", "Pins fixture"))
                AiAccess.activate(token)
            }
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                val req = chain.request(); requests += req
                val path = req.url.encodedPath
                var code = 200
                val text = when {
                    path == "/teams/A/favorites" -> {
                        val snapshot = entries
                        if (holdNextA && req.method == "GET") {
                            holdNextA = false; held.countDown()
                            check(release.await(10, TimeUnit.SECONDS))
                            """{"revision":1,"entries":[{"key":"agent-session:old","label":"Late A label"}]}"""
                        } else if (failFavorites) { code = 503; "{}" }
                        else if (req.method == "PUT") {
                            val buffer = okio.Buffer(); req.body!!.writeTo(buffer)
                            val body = JsonValue.parse(buffer.readUtf8())!!
                            assertEquals(revision.toDouble(), body["expectedRevision"]?.numberValue)
                            entries = Http.json.encodeToString(JsonValue.serializer(), body["entries"]!!)
                            revision++
                            """{"revision":$revision,"entries":$entries}"""
                        } else """{"revision":$revision,"entries":$snapshot}"""
                    }
                    path == "/teams/B/favorites" -> """{"revision":1,"entries":[{"key":"agent-session:b","label":"Team B pin"}]}"""
                    path == "/agent/conversations" -> if (emptyHistory) """{"conversations":[],"hasMore":false}""" else
                        """{"conversations":[{"sessionId":"normal","teamId":"${req.url.queryParameter("teamId")}","title":"Normal history"}],"hasMore":false}"""
                    path == "/agent/conversations/beyond" -> Http.json.encodeToString(AgentConversationDetail.serializer(), AgentConversationDetail(
                        title = "Authorized archived detail", isOwner = owner, archivedAt = Instant.EPOCH,
                        messages = listOf(ChatMessage(id = "saved", parts = listOf(ChatPart.Text(text = "Authorized fixture transcript"))))))
                    path == "/agent/conversations/denied" -> { code = 403; """{"error":{"message":"Fixture access denied"}}""" }
                    else -> { code = 404; "{}" }
                }
                Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
                    .body(text.toResponseBody(Http.jsonMedia)).build()
            }.build()
            for (name in listOf("client", "chatClient")) {
                val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
                originals[name] = field.get(null) as OkHttpClient; field.set(null, client)
            }
        }
        override fun after() {
            release.countDown()
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                if (::store.isInitialized) store.disposeForConsent()
                state(AiAccess, "state", false).value = savedAccess
                state(app.authSession, "state").value = savedAuth
                AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(app.authSession, savedAuthToken)
                val editor = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).edit().clear()
                preferences.forEach { (key, value) -> when(value) {
                    is String -> editor.putString(key, value)
                    is Boolean -> editor.putBoolean(key, value)
                    is Int -> editor.putInt(key, value)
                    is Long -> editor.putLong(key, value)
                    is Float -> editor.putFloat(key, value)
                    is Set<*> -> @Suppress("UNCHECKED_CAST") editor.putStringSet(key, value as Set<String>)
                } }; editor.commit()
            }
            originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(network).around(compose)

    private fun render() {
        compose.runOnIdle {
            AiAccess.grant(token)
            store = AgentStore(token, compose.activity)
            state(store, "selectedTeam").value = Team("A", "Fixture A")
            store.acceptMemberships(listOf(Team("A", "Fixture A"), Team("B", "Fixture B")))
            state(store, "phase").value = AgentStore.Phase.Loaded
            state(store, "conversations").value = if (emptyHistory) emptyList<AgentConversation>() else listOf(AgentConversation("normal", "A", "Synthetic parent", parentSessionId = null),
                AgentConversation("child", "A", "Synthetic child", parentSessionId = "normal"),
                AgentConversation("leaf", "A", "Synthetic leaf", parentSessionId = "child"),
                AgentConversation("mine", "A", "Synthetic own chat", isOwner = true),
                AgentConversation("shared", "A", "Synthetic shared chat", isOwner = false))
            val auth = AuthSession(app, app.tokenStore)
            AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
            compose.activity.setContent {
                NuphosTheme { CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    val nav = rememberNavController()
                    NavHost(nav, startDestination = "history") {
                        composable("history") { AgentPage(false, {}, nav) }
                        composable("conversation/{sessionId}") { back ->
                            androidx.compose.material3.Text("Opened synthetic ${back.arguments!!.getString("sessionId")!!}")
                        }
                    }
                } }
            }
        }
        waitText("Synthetic parent")
    }
    private fun waitText(text: String) { compose.waitUntil(5_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() } }

    private fun shot(name: String) {
        compose.waitForIdle()
        val bitmap = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        val file = java.io.File(app.getExternalFilesDir(null), "nesting-$name.png")
        file.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }

    @Test fun syntheticLoadedPinTreeFoldsWithoutNavigationAndChildOpensItsOwnId() {
        render()
        compose.onNodeWithText("Synthetic parent").assertExists()
        compose.onNodeWithText("Synthetic child").assertExists()
        compose.onNodeWithContentDescription("Hide 2 threads").performClick()
        compose.onNodeWithText("Synthetic child").assertDoesNotExist()
        compose.onNodeWithText("My chats").assertExists()
        compose.onNodeWithText("Shared").assertExists()
        shot("collapsed")
        compose.onNodeWithContentDescription("Show 2 threads").performClick()
        compose.onNodeWithText("Synthetic child").assertExists()
        shot("expanded")
        compose.onNodeWithText("Synthetic child").performClick()
        compose.onNodeWithText("Opened synthetic child").assertExists()
        assertTrue(requests.none { it.method != "GET" })
    }
}
