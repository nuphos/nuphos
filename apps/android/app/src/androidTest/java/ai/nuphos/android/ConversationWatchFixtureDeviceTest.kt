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
class ConversationWatchFixtureDeviceTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val requests = CopyOnWriteArrayList<Request>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private val token = "watch-fixture-no-credentials"
    private lateinit var store: AgentStore
    private lateinit var app: NuphosApplication
    private var savedAccess: Any? = null
    private var savedAuth: Any? = null
    private var savedAuthToken: String? = null
    private var preferences: Map<String, *> = emptyMap<String, Any>()
    @Volatile private var legacyServer = false
    @Volatile private var watched = true
    @Volatile private var rejectNext = false
    @Volatile private var holdWrite: java.util.concurrent.CountDownLatch? = null
    private val entries = """[{"key":"agent-session:normal","label":"Synthetic pin"}]"""
    @Suppress("UNCHECKED_CAST") private fun state(target: Any, name: String, delegated: Boolean = true) =
        target.javaClass.getDeclaredField(name + if (delegated) "\$delegate" else "").also { it.isAccessible = true }.get(target) as MutableState<Any?>

    private val network = object : ExternalResource() {
        override fun before() {
            app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
            require(app.packageName == "ai.nuphos.android.watchfixture") { "Use the independent watch fixture package; never the Play installation." }
            require(InstrumentationRegistry.getArguments().getString("isolatedWatch") == "true")
            preferences = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).all.toMap()
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                savedAccess = state(AiAccess, "state", false).value
                savedAuth = state(app.authSession, "state").value
                val tokenField = AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }
                savedAuthToken = tokenField.get(app.authSession) as String?
                tokenField.set(app.authSession, token)
                state(app.authSession, "state").value = AuthSession.State.SignedIn(NuphosUser("watch-fixture", "watch@example.test", "Watch fixture"))
                AiAccess.activate(token)
            }
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                val req = chain.request(); requests += req
                val path = req.url.encodedPath
                val mutation = path == "/agent/conversations/parent/watch" && req.method in setOf("PUT", "DELETE")
                val denied = mutation && rejectNext
                if (denied) rejectNext = false
                if (mutation) check(holdWrite?.await(10, java.util.concurrent.TimeUnit.SECONDS) != false)
                if (mutation && !denied) watched = req.method == "PUT"
                val text = when {
                    mutation && denied -> """{"error":"synthetic unavailable"}"""
                    mutation -> """{"ok":true,"watching":$watched}"""
                    path == "/agent/conversations" && req.url.queryParameter("teamId") == "B" -> """{"conversations":[],"hasMore":false}"""
                    path == "/agent/conversations" -> """{"conversations":[{"sessionId":"parent","teamId":"A","title":"Synthetic shared parent","watching":$watched,"readOnly":true,"isOwner":false},{"sessionId":"child","teamId":"A","title":"Synthetic child","parentSessionId":"parent","isOwner":false,"readOnly":true,"watching":$watched}],"hasMore":false}"""
                    path == "/agent/conversations/parent" || path == "/agent/conversations/child" -> """{"messages":[],"readOnly":true,"isOwner":false,"watching":$watched}"""

                    path == "/teams/A/favorites" -> """{"revision":1,"entries":$entries}"""
                    else -> "{}"
                }
                val code = if (denied) 503 else if (mutation || path in setOf("/teams/A/favorites", "/agent/conversations", "/agent/conversations/parent", "/agent/conversations/child")) 200 else 404
                Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
                    .body((if (legacyServer) text.replace(",\"watching\":$watched", "") else text).toResponseBody(Http.jsonMedia)).build()
            }.build()
            for (name in listOf("client", "chatClient")) {
                val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
                originals[name] = field.get(null) as OkHttpClient; field.set(null, client)
            }
        }
        override fun after() {
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
            state(store, "conversations").value = listOf(
                AgentConversation("parent", "A", "Synthetic shared parent", watching = true, isOwner = false, readOnly = true),
                AgentConversation("child", "A", "Synthetic child", parentSessionId = "parent", watching = true, isOwner = false, readOnly = true))
            val auth = AuthSession(app, app.tokenStore)
            AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
            compose.activity.setContent {
                NuphosTheme(darkTheme = false) { androidx.compose.material3.Surface(Modifier.fillMaxSize().systemBarsPadding()) { CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    val nav = rememberNavController()
                    NavHost(nav, startDestination = "history") {
                        composable("history") { AgentPage(false, {}, nav) }
                        composable("conversation/{sessionId}") { back ->
                            val session = store.session(back.arguments!!.getString("sessionId")!!, "Synthetic shared parent")
                            androidx.compose.runtime.LaunchedEffect(session) { session.load() }
                            androidx.compose.foundation.layout.Column {
                                androidx.compose.material3.Text("Synthetic shared conversation")
                                ai.nuphos.android.ui.chat.ConversationMenu(session, store, {})
                            }
                        }
                    }
                } } }
            }
        }
        waitText("Synthetic shared parent")
    }
    private fun waitText(text: String) { compose.waitUntil(5_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() } }

    private fun shot(name: String) {
        compose.waitForIdle()
        Thread.sleep(350)
        val bitmap = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        val file = java.io.File(app.getExternalFilesDir(null), "watch-$name.png")
        file.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }

    @Test fun sharedReaderCanUnwatchCascadeAndWatchAgainFromListAndMenu() {
        render()
        shot("list-before")
        compose.onAllNodesWithText("Unwatch")[0].performClick()
        compose.waitUntil(5_000) { !watched && store.watchingSessionId == null && store.conversations.all { it.watching == false } }
        shot("list-after-cascade")
        compose.onNodeWithText("Synthetic shared parent").performClick()
        waitText("Synthetic shared conversation")
        compose.onNodeWithContentDescription("Agent actions").performClick()
        waitText("Watch")
        shot("shared-menu-watch")
        compose.onNodeWithText("Rename").assertDoesNotExist()
        compose.onNodeWithText("Watch").performClick()
        compose.waitUntil(5_000) { watched && store.watchingSessionId == null }
        compose.onNodeWithContentDescription("Agent actions").performClick()
        waitText("Unwatch")
        shot("shared-menu-unwatch")
        val writes = requests.filter { it.method in setOf("PUT", "DELETE") }
        assertEquals(listOf("DELETE", "PUT"), writes.map { it.method })
        assertTrue(writes.all { it.url.encodedPath.endsWith("/parent/watch") && it.url.queryParameter("teamId") == "A" })
    }
    @Test fun duplicateTapAndLateTeamResponseStayIsolated() {
        render()
        val hold = java.util.concurrent.CountDownLatch(1)
        holdWrite = hold
        val jobs = mutableListOf<Job>()
        compose.runOnIdle {
            val row = store.conversations.first()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
            jobs += scope.launch { store.setWatching(row) }
            jobs += scope.launch { store.setWatching(row) }
        }
        try {
            compose.waitUntil(5_000) { requests.any { it.method == "DELETE" } }
            assertEquals(1, requests.count { it.method == "DELETE" })
            compose.runOnIdle { store.select(Team("B", "Fixture B")) }
            hold.countDown()
            compose.waitUntil(5_000) { jobs.all { it.isCompleted } && store.phase == AgentStore.Phase.Loaded }
            assertEquals("B", store.selectedTeam?.id)
            assertTrue(store.conversations.isEmpty())
            assertNull(store.watchError)
            assertNull(store.watchingSessionId)
        } finally { hold.countDown(); jobs.forEach { it.cancel() } }
    }
    @Test fun legacyServerHidesControlsInListAndMenu() {
        render()
        legacyServer = true
        val job = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate).launch { store.reload() }
        compose.waitUntil(5_000) { job.isCompleted && store.conversations.all { it.watching == null } }
        compose.onAllNodesWithText("Unwatch").assertCountEquals(0)
        compose.onAllNodesWithText("Watch").assertCountEquals(0)
        shot("legacy-list")
        compose.onNodeWithText("Synthetic shared parent").performClick()
        waitText("Synthetic shared conversation")
        compose.onNodeWithContentDescription("Agent actions").performClick()
        compose.onAllNodesWithText("Unwatch").assertCountEquals(0)
        compose.onAllNodesWithText("Watch").assertCountEquals(0)
        shot("legacy-menu")
        assertTrue(requests.none { it.method in setOf("PUT", "DELETE") })
    }
    @Test fun failedWriteLeavesStateAndAllowsExplicitRetry() {
        render()
        rejectNext = true
        compose.onAllNodesWithText("Unwatch")[0].performClick()
        waitText("Watch update failed")
        assertTrue(watched)
        assertEquals(true, store.conversations.first().watching)
        shot("failure-retry")
        compose.onNodeWithText("Refresh").performClick()
        compose.waitUntil(5_000) { store.watchError == null }
        compose.onAllNodesWithText("Unwatch")[0].performClick()
        compose.waitUntil(5_000) { !watched && store.watchingSessionId == null }
        assertEquals(2, requests.count { it.method == "DELETE" })
    }
}
