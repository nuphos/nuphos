package ai.nuphos.android

import android.content.Context
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
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
import java.util.concurrent.CopyOnWriteArrayList

/** Synthetic local transport only. The outer rule blocks the real Activity's reads. */
@RunWith(AndroidJUnit4::class)
class PinnedListFixtureDeviceTest {
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
    @Volatile private var holdFavorites = false
    private val favoritesHeld = java.util.concurrent.CountDownLatch(1)
    private val releaseFavorites = java.util.concurrent.CountDownLatch(1)
    private var entries = """[{"key":"agent-session:normal","label":"Synthetic pin"}]"""
    @Suppress("UNCHECKED_CAST") private fun state(target: Any, name: String, delegated: Boolean = true) =
        target.javaClass.getDeclaredField(name + if (delegated) "\$delegate" else "").also { it.isAccessible = true }.get(target) as MutableState<Any?>

    private val network = object : ExternalResource() {
        override fun before() {
            app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
            require(app.packageName == "ai.nuphos.android.pinios1370")
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
                if (path == "/teams/A/favorites" && holdFavorites) {
                    favoritesHeld.countDown()
                    check(releaseFavorites.await(5, java.util.concurrent.TimeUnit.SECONDS))
                }
                val text = when (path) {
                    "/teams/A/favorites" -> """{"revision":1,"entries":$entries}"""
                    "/agent/conversations" -> """{"conversations":${kotlinx.serialization.json.Json.encodeToString(kotlinx.serialization.builtins.ListSerializer(AgentConversation.serializer()), if (::store.isInitialized) store.conversations else emptyList())},"hasMore":false}"""
                    else -> "{}"
                }
                val code = if (path in setOf("/teams/A/favorites", "/agent/conversations")) 200 else 404
                Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
                    .body(text.toResponseBody(Http.jsonMedia)).build()
            }.build()
            for (name in listOf("client", "chatClient")) {
                val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
                originals[name] = field.get(null) as OkHttpClient; field.set(null, client)
            }
        }
        override fun after() {
            releaseFavorites.countDown()
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
            state(store, "conversations").value = listOf(AgentConversation("normal", "A", "Synthetic parent", parentSessionId = null),
                AgentConversation("child", "A", "Synthetic child", parentSessionId = "normal"),
                AgentConversation("leaf", "A", "Synthetic leaf", parentSessionId = "child", isOwner = true, unread = JsonValue.Bool(true)),
                AgentConversation("mine", "A", "Synthetic own chat", isOwner = true),
                AgentConversation("shared", "A", "Synthetic shared chat", isOwner = false))
            val auth = AuthSession(app, app.tokenStore)
            AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
            compose.activity.setContent {
                NuphosTheme { androidx.compose.material3.Surface(Modifier.fillMaxSize().systemBarsPadding()) { CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    val nav = rememberNavController()
                    NavHost(nav, startDestination = "history") {
                        composable("history") { AgentPage(false, {}, nav) }
                        composable("conversation/{sessionId}") { back ->
                            androidx.compose.material3.Text("Opened synthetic ${back.arguments!!.getString("sessionId")!!}")
                        }
                    }
                } } }
            }
        }
        waitText("Synthetic parent")
    }
    private fun waitText(text: String) { compose.waitUntil(5_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() } }

    private fun shot(name: String) {
        compose.waitForIdle()
        Thread.sleep(350)
        val bitmap = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        val file = java.io.File(app.getExternalFilesDir(null), "pinios-$name.png")
        file.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }

    private fun setPins(vararg ids: String) {
        entries = ids.joinToString(prefix="[", postfix="]") { "{\"key\":\"agent-session:$it\",\"label\":\"Pin $it\"}" }
        state(store,"favorites").value = ConversationActions.Favorites(JsonValue.parse(entries)!!.arrayValue!!,2)
    }
    private fun top(text: String) = compose.onNodeWithText(text).fetchSemanticsNode().boundsInRoot.top
    @Test fun rankedPinsBadgeAndThreadGesturesInRealAgentPage() {
        render()
        compose.runOnIdle {
            state(store,"conversations").value = listOf(AgentConversation("normal","A","Synthetic parent"),AgentConversation("a","A","Pin A"),AgentConversation("b","A","Pin B"),AgentConversation("c","A","Pin C"))
            setPins("a","b","c")
        }
        compose.onNodeWithText("Pinned").assertDoesNotExist()
        compose.onAllNodesWithContentDescription("Pinned agent",useUnmergedTree=true).assertCountEquals(3)
        assertTrue(top("Pin C") < top("Pin B"));assertTrue(top("Pin B") < top("Pin A"));assertTrue(top("Pin A") < top("Synthetic parent"))
        shot("ranked")
        compose.onNodeWithTag("row-more:c",useUnmergedTree=true).performClick()
        compose.onNodeWithTag("menu-pin:c").assertTextContains("Unpin")
        androidx.test.espresso.Espresso.pressBack()
        compose.onNodeWithTag("conversation-row:c").performTouchInput { swipeLeft() }
        compose.onNodeWithTag("row-rail:c").assertExists()
        assertTrue(requests.none { it.method != "GET" })
        androidx.test.espresso.Espresso.pressBack()
        compose.runOnIdle { setPins("a","c") }
        assertTrue(top("Pin C") < top("Pin A"));assertTrue(top("Pin A") < top("Pin B"))
        compose.runOnIdle { setPins("a","c","b") }
        assertTrue(top("Pin B") < top("Pin C"))
        shot("repinned")
    }
    @Test fun unloadedPinsKeepRankAndBecomeLoadedWithoutDuplicate() {
        render()
        compose.runOnIdle { setPins("normal","outside"); }
        compose.onNodeWithText("Pin outside").assertExists()
        assertTrue(top("Pin outside") < top("Synthetic parent"))
        shot("unloaded")
        compose.runOnIdle {
            state(store,"conversations").value = store.conversations + AgentConversation("outside","A","Pin outside")
        }
        compose.onAllNodesWithText("Pin outside").assertCountEquals(1)
        compose.onNodeWithTag("conversation-row:outside").assertExists()
        shot("loaded")
        assertTrue(requests.none { it.method != "GET" })
    }
    @Test fun desktopHrefPinAppearsAtTopAfterAsynchronousFavoritesRead() {
        holdFavorites = true
        entries = """[{"href":"/teams/A/agent/outside","label":"Desktop remote pin"},{"href":"/teams/A/agent/child","label":"Desktop child pin"},{"href":"/teams/B/agent/foreign","label":"Foreign team pin"},{"href":"https://example.com/teams/A/agent/external","label":"External pin"},{"key":"agent-session:child","label":"Duplicate child"}]"""
        render()
        assertTrue(favoritesHeld.await(5, java.util.concurrent.TimeUnit.SECONDS))
        compose.onNodeWithText("Loading pinned agents…").assertIsDisplayed()
        compose.onNodeWithText("Desktop remote pin").assertDoesNotExist()
        releaseFavorites.countDown()
        waitText("Desktop remote pin")
        compose.onNodeWithText("Foreign team pin").assertDoesNotExist()
        compose.onNodeWithText("External pin").assertDoesNotExist()
        compose.onNodeWithText("Loading pinned agents…").assertDoesNotExist()
        assertTrue(top("Synthetic child") < top("Desktop remote pin"))
        assertTrue(top("Desktop remote pin") < top("Synthetic parent"))
        compose.onAllNodesWithContentDescription("Pinned agent", useUnmergedTree=true).assertCountEquals(2)
        compose.onNodeWithTag("row-more:child", useUnmergedTree=true).performClick()
        compose.onNodeWithTag("menu-pin:child").assertTextContains("Unpin")
        androidx.test.espresso.Espresso.pressBack()
        shot("desktop-href-late")
        compose.onNodeWithText("Desktop remote pin").performClick()
        waitText("Opened synthetic outside")
        assertTrue(requests.none { it.method != "GET" })
    }

}
