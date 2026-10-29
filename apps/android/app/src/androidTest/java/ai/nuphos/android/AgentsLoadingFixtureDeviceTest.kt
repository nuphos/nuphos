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

/** All HTTP requests are intercepted; no credentials or server are used. */
@RunWith(AndroidJUnit4::class)
class AgentsLoadingFixtureDeviceTest {
    private val compose = createAndroidComposeRule<androidx.activity.ComponentActivity>()
    private val requests = CopyOnWriteArrayList<Request>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private val token = "history-fixture-no-credentials"
    private lateinit var store: AgentStore
    private lateinit var auth: AuthSession
    private lateinit var app: NuphosApplication
    private var savedAccess: Any? = null
    private val work = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var savedLastTeam: String? = null
    @Volatile private var failList = false
    @Volatile private var holdNextList = false
    private val listHeld = CountDownLatch(1)
    private val listRelease = CountDownLatch(1)
    private val followingHeld = CountDownLatch(1)
    private val followingRelease = CountDownLatch(1)
    @Volatile private var listActivity = 4L
    @Volatile private var listRead = 1L
    @Volatile private var readActivity = 4L
    @Volatile private var listTitle = "History fixture"
    @Volatile private var backgroundPhase = false
    @Volatile private var owner = true
    @Volatile private var failDetail = false
    @Volatile private var failRead = false
    @Volatile private var holdRead = false
    @Volatile private var holdDetail = false
    private val detailHeld = CountDownLatch(1)
    private val detailRelease = CountDownLatch(1)
    private val detailReturned = CountDownLatch(1)
    private val held = CountDownLatch(1)
    private val release = CountDownLatch(1)
    @Suppress("UNCHECKED_CAST") private fun state(target: Any, name: String, delegated: Boolean = true) =
        target.javaClass.getDeclaredField(name + if (delegated) "\$delegate" else "").also { it.isAccessible = true }.get(target) as MutableState<Any?>
    private fun row(seq: Long = 4) = AgentConversation("saved", "A", "History fixture", isOwner = owner,
        activitySeq = JsonValue.Number(seq.toDouble()), readSeq = JsonValue.Number(1.0), unread = JsonValue.Bool(owner),
        activeRun = JsonValue.obj("streamId" to JsonValue.Str("run")),
        runtimeState = JsonValue.parse("""{"schemaVersion":2,"state":"active","phase":"working","epoch":"a","revision":2}"""))
    @Volatile private var crossTeamPins = false
    private val teamAPageHeld = CountDownLatch(1)
    private val teamAPageRelease = CountDownLatch(1)
    private val teamBPageHeld = CountDownLatch(1)
    private val teamBPageRelease = CountDownLatch(1)
    @Volatile private var pinnedPage = false
    @Volatile private var pinFavorite = false
    private val pinPageHeld = CountDownLatch(1)
    private val pinPageRelease = CountDownLatch(1)
    @Volatile private var emptyHistory = false
    @Volatile private var holdFavorites = false
    private val favoritesHeld = CountDownLatch(1)
    private val favoritesRelease = CountDownLatch(1)
    private val network = object : ExternalResource() {
        override fun before() {
            check(InstrumentationRegistry.getInstrumentation().targetContext.packageName.endsWith(".agentsaudit1382"))
            app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
            savedLastTeam = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).getString("nuphos.workspace.lastTeamId", null)
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                savedAccess = state(AiAccess, "state", false).value
                AiAccess.activate(token)
            }
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                val req = chain.request(); requests += req
                var code = 200
                val body = when (req.url.encodedPath) {
                    "/teams/A/favorites", "/teams/B/favorites" -> {
                        if (holdFavorites) { favoritesHeld.countDown(); check(favoritesRelease.await(15, TimeUnit.SECONDS)) }
                        if (crossTeamPins) {
                            val team = if (req.url.encodedPath.contains("/A/")) "A" else "B"
                            """{"revision":1,"entries":[{"key":"agent-session:pin-$team","label":"Pin $team"}]}"""
                        } else if (pinFavorite) """{"revision":1,"entries":[{"key":"agent-session:saved","label":"History fixture"}]}"""
                        else """{"revision":1,"entries":[]}"""
                    }
                    "/agent/auto-mode/bypass" -> """{"bypass":false}"""
                    "/agent/conversations" -> {
                        val team = req.url.queryParameter("teamId") ?: "A"
                        val snapshot = row(listActivity).copy(teamId = team, title = if (team == "A") listTitle else "Team B history",
                            readSeq = JsonValue.Number(listRead.toDouble()), unread = JsonValue.Bool(owner && listActivity > listRead),
                            runtimeState = if (backgroundPhase) JsonValue.parse("""{"schemaVersion":2,"state":"active","phase":"background_tools","epoch":"a","revision":2}""") else row().runtimeState)
                        val fail = failList
                        if (holdNextList) { holdNextList = false; listHeld.countDown(); check(listRelease.await(10, TimeUnit.SECONDS)) }
                        if (req.url.queryParameter("cursor") == "following-page") { followingHeld.countDown(); check(followingRelease.await(10, TimeUnit.SECONDS)) }
                        if (crossTeamPins) {
                            val isPage = req.url.queryParameter("cursor") != null
                            if (isPage) {
                                val gate = if (team == "A") teamAPageHeld else teamBPageHeld
                                val resume = if (team == "A") teamAPageRelease else teamBPageRelease
                                gate.countDown(); check(resume.await(20, TimeUnit.SECONDS))
                            }
                            Http.json.encodeToString(AgentConversationsPage.serializer(), AgentConversationsPage(
                                listOf(snapshot.copy(sessionId = if (isPage) "pin-$team" else "first-$team", title = if (isPage) "Pin $team" else "First $team")),
                                nextCursor = if (isPage) null else "page-$team", hasMore = !isPage))
                        } else if (fail) { code = 503; "{}" }
                        else if (pinnedPage && req.url.queryParameter("cursor") == "pin-page") {
                            pinPageHeld.countDown(); check(pinPageRelease.await(15, TimeUnit.SECONDS))
                            Http.json.encodeToString(AgentConversationsPage.serializer(), AgentConversationsPage(listOf(snapshot)))
                        } else if (pinnedPage) Http.json.encodeToString(AgentConversationsPage.serializer(),
                            AgentConversationsPage(listOf(snapshot.copy(sessionId = "first-page", title = "First page agent")), nextCursor = "pin-page", hasMore = true))
                        else Http.json.encodeToString(AgentConversationsPage.serializer(), AgentConversationsPage(if (emptyHistory) emptyList() else listOf(snapshot)))
                    }
                    "/agent/conversations/saved" -> {
                        if (holdDetail) { detailHeld.countDown(); check(detailRelease.await(10, TimeUnit.SECONDS)) }
                        detailReturned.countDown()
                        if (failDetail) { code = 403; "{}" } else
                        Http.json.encodeToString(AgentConversationDetail.serializer(), AgentConversationDetail(isOwner = owner,
                            activitySeq = JsonValue.Number(4.0), agentRuntime = "nuphos", title = "History fixture",
                            messages = listOf(ChatMessage(id = "saved-message", parts = listOf(ChatPart.Text(text = "Displayed owner transcript"))))))
                    }
                    "/agent/conversations/saved/read" -> {
                        val buffer = okio.Buffer(); req.body!!.writeTo(buffer)
                        val payload = JsonValue.parse(buffer.readUtf8())!!
                        assertEquals("A", payload["teamId"]?.stringValue)
                        assertEquals(4.0, payload["seq"]?.numberValue)
                        if (holdRead) { held.countDown(); check(release.await(10, TimeUnit.SECONDS)) }
                        if (failRead) { code = 503; "{}" } else """{"activitySeq":$readActivity,"readSeq":4,"unread":${readActivity > 4}}"""
                    }
                    else -> { code = 404; "{}" }
                }
                Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
                    .body(body.toResponseBody(Http.jsonMedia)).build()
            }.build()
            for (name in listOf("client", "chatClient")) {
                val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
                originals[name] = field.get(null) as OkHttpClient; field.set(null, client)
            }
        }
        override fun after() {
            teamAPageRelease.countDown()
            teamBPageRelease.countDown()
            pinPageRelease.countDown()
            favoritesRelease.countDown()
            release.countDown()
            detailRelease.countDown()
            listRelease.countDown()
            followingRelease.countDown()
            work.cancel()
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                if (::store.isInitialized) store.disposeForConsent()
                state(AiAccess, "state", false).value = savedAccess
                val editor = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).edit()
                if (savedLastTeam == null) editor.remove("nuphos.workspace.lastTeamId") else editor.putString("nuphos.workspace.lastTeamId", savedLastTeam)
                editor.commit()
            }
            originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(network).around(compose)
    private fun render(showHistory: Boolean = true) {
        compose.runOnIdle {
            AiAccess.grant(token)
            store = AgentStore(token, compose.activity)
            state(store, "selectedTeam").value = Team("A", "Fixture A")
            store.acceptMemberships(listOf(Team("A", "Fixture A"), Team("B", "Fixture B")))
            state(store, "phase").value = AgentStore.Phase.Idle
            auth = AuthSession(app, app.tokenStore)
            AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
            compose.activity.setContent {
                NuphosTheme(darkTheme = InstrumentationRegistry.getArguments().getString("fixtureDark") == "true") { CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    val nav = rememberNavController()
                    if (showHistory) NavHost(nav, startDestination = "history") {
                        composable("history") { AgentPage(false, {}, nav) }
                        composable("conversation/{sessionId}") { back ->
                            ConversationScreen(back.arguments!!.getString("sessionId")!!, false, { nav.popBackStack() }, nav)
                        }
                    }
                } }
            }
        }

    }
    private fun waitText(text: String) { compose.waitUntil(5_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() } }
    private fun readCount() = requests.count { it.url.encodedPath.endsWith("/read") }
    @Test fun emptyHistoryWaitsForHeldPinsBeforeClaimingEmpty() {
        emptyHistory = true; holdFavorites = true; render()
        compose.waitUntil(5_000) { favoritesHeld.count == 0L && store.phase == AgentStore.Phase.Loaded }
        compose.onNodeWithText("No agents yet").assertDoesNotExist()
        compose.onNodeWithText("Loading pinned agents…").assertDoesNotExist()
        favoritesRelease.countDown()
        waitText("No agents yet")
    }
    @Test fun coldHistoryHasLoadingButNoFakeRowsOrEmptyMessage() {
        holdNextList = true; render()
        compose.waitUntil(5_000) { listHeld.count == 0L }
        compose.onNodeWithText("Loading agents…").assertIsDisplayed()
        compose.onNodeWithText("No agents yet").assertDoesNotExist()
        compose.onNodeWithText("History fixture").assertDoesNotExist()
        listRelease.countDown(); waitText("History fixture")
    }
    @Test fun heldRefreshKeepsExistingRowsAndFailureRemainsRetryable() {
        render(); waitText("History fixture")
        holdNextList = true; failList = true
        compose.runOnIdle { store.refresh() }
        compose.waitUntil(5_000) { listHeld.count == 0L }
        compose.onNodeWithText("History fixture").assertIsDisplayed()
        compose.onNodeWithText("Loading agents…").assertDoesNotExist()
        listRelease.countDown()
        waitText("Could not refresh agents. Showing last loaded history.")
        compose.onNodeWithText("History fixture").assertIsDisplayed()
        failList = false; compose.onNodeWithText("Retry history").performClick()
        compose.waitUntil(5_000) { store.phaseError == null }
    }
    @Test fun initialFailureRemainsVisibleAndRetryRecovers() {
        failList = true; render(); waitText("Couldn't load agents")
        compose.onNodeWithText("No agents yet").assertDoesNotExist()
        failList = false; compose.onNodeWithText("Try again").performClick()
        waitText("History fixture")
    }
    @Test fun teamSwitchRejectsHeldOldTeamAndNeverKeepsItsRows() {
        render(); waitText("History fixture"); holdNextList = true
        compose.runOnIdle { store.refresh() }
        compose.waitUntil(5_000) { listHeld.count == 0L }
        compose.runOnIdle { store.select(Team("B", "Fixture B")); assertTrue(store.conversations.isEmpty()) }
        waitText("Team B history")
        listRelease.countDown()
        compose.waitUntil(5_000) { !store.isRefreshing }
        compose.onNodeWithText("History fixture").assertDoesNotExist()
        compose.onNodeWithText("Team B history").assertIsDisplayed()
    }
    @Test fun queryChangeRejectsHeldHistoryAndFailedQueryDoesNotLeakCache() {
        render(); waitText("History fixture"); holdNextList = true
        compose.runOnIdle { store.refresh() }
        compose.waitUntil(5_000) { listHeld.count == 0L }
        failList = true
        compose.runOnIdle { store.updateSearch("different"); assertTrue(store.conversations.isEmpty()) }
        waitText("Couldn't load agents")
        listRelease.countDown()
        compose.onNodeWithText("History fixture").assertDoesNotExist()
        compose.onNodeWithText("No matches").assertDoesNotExist()
    }

    @Test fun refreshKeepsFullPinnedRowWhileItsPageIsHeld() {
        pinFavorite = true; render(); waitText("History fixture")
        compose.waitUntil(5_000) { !store.favoritesLoading && !store.isRefreshing }
        compose.onNodeWithTag("conversation-row:saved").assertIsDisplayed()
        pinnedPage = true
        compose.runOnIdle { store.refresh() }
        compose.waitUntil(5_000) { pinPageHeld.count == 0L }
        compose.onNodeWithTag("conversation-row:saved").assertIsDisplayed()
        pinPageRelease.countDown()
        compose.waitUntil(5_000) { !store.isRefreshing }
        compose.onNodeWithTag("conversation-row:saved").assertIsDisplayed()
    }
    @Test fun coldPinnedPageDoesNotPaintShortcutBeforeFullRow() {
        pinFavorite = true; pinnedPage = true; render()
        compose.waitUntil(5_000) { pinPageHeld.count == 0L }
        compose.onNodeWithText("History fixture").assertDoesNotExist()
        compose.onNodeWithText("Loading agents…").assertIsDisplayed()
        pinPageRelease.countDown()
        waitText("History fixture")
        compose.onNodeWithTag("conversation-row:saved").assertIsDisplayed()
    }

    @Test fun failedHistoryShowsRetryEvenWhileInitialFavoritesIsHeld() {
        failList = true; holdFavorites = true; render()
        compose.waitUntil(5_000) { favoritesHeld.count == 0L && store.phase == AgentStore.Phase.Failed }
        compose.onNodeWithText("Couldn't load agents").assertIsDisplayed()
        compose.onNodeWithText("Try again").assertIsDisplayed()
        compose.onNodeWithText("Loading agents…").assertDoesNotExist()
        failList = false; compose.onNodeWithText("Try again").performClick()
        compose.waitUntil(5_000) { store.phase == AgentStore.Phase.Loaded }
        favoritesRelease.countDown(); waitText("History fixture")
    }
    @Test fun newWorkspaceHydratesWithoutWaitingForOldOwnerAndOldFinallyCannotClearIt() = hydrationAcrossWorkspace(cancelOld = false)
    @Test fun cancellingOldWorkspaceOwnerCannotClearNewOwner() = hydrationAcrossWorkspace(cancelOld = true)
    private fun hydrationAcrossWorkspace(cancelOld: Boolean) {
        crossTeamPins = true; render(showHistory = false)
        lateinit var a: Job
        compose.runOnIdle { a = work.launch { store.reload(); store.loadFavorites() } }
        compose.waitUntil(5_000) { teamAPageHeld.count == 0L }
        compose.runOnIdle { store.select(Team("B", "Fixture B")); work.launch { store.loadFavorites() } }
        compose.waitUntil(5_000) { teamBPageHeld.count == 0L }
        if (cancelOld) a.cancel()
        teamAPageRelease.countDown()
        compose.waitUntil(5_000) { a.isCompleted }
        compose.runOnIdle {
            assertTrue(store.loadingPinnedHistory)
            assertEquals("B", store.selectedTeam?.id)
            assertTrue(store.conversations.none { it.teamId == "A" })
        }
        teamBPageRelease.countDown()
        compose.waitUntil(5_000) { store.conversations.any { it.sessionId == "pin-B" } && !store.loadingPinnedHistory }
        compose.runOnIdle { assertTrue(store.conversations.none { it.teamId == "A" }) }
    }

}
