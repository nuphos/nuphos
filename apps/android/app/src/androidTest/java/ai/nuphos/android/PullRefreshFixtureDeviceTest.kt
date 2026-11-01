package ai.nuphos.android

import android.content.Context
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.ui.Modifier
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Synthetic local transport only. The outer rule blocks the real Activity's reads. */
@RunWith(AndroidJUnit4::class)
class PullRefreshFixtureDeviceTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val requests = CopyOnWriteArrayList<Request>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private val token = "refresh-fixture-no-credentials"
    private lateinit var navController: androidx.navigation.NavHostController
    private lateinit var store: AgentStore
    private lateinit var app: NuphosApplication
    private lateinit var fixtureAuth: AuthSession
    private val searching = androidx.compose.runtime.mutableStateOf(false)
    private var savedAccess: Any? = null
    private var savedAuth: Any? = null
    private var savedAuthToken: String? = null
    private var preferences: Map<String, *> = emptyMap<String, Any>()
    @Volatile private var sortHistory = false
    @Volatile private var treeHistory = false
    @Volatile private var failHistory = false
    @Volatile private var holdPage = false
    @Volatile private var holdHistory = false
    @Volatile private var historyTitle = "Normal history"
    private val historyHeld = CountDownLatch(1)
    private val historyRelease = CountDownLatch(1)
    @Volatile private var emptyHistory = false
    @Volatile private var failFavorites = false
    @Volatile private var entries = """[{"key":"agent-session:beyond","label":"Beyond first page"},{"key":"agent-session:normal","label":"Normal pin"},{"key":"agent-session:denied","label":"Stale pin"},{"href":"/dashboard","label":"Dashboard"}]"""
    @Suppress("UNCHECKED_CAST") private fun state(target: Any, name: String, delegated: Boolean = true) =
        target.javaClass.getDeclaredField(name + if (delegated) "\$delegate" else "").also { it.isAccessible = true }.get(target) as MutableState<Any?>

    private val network = object : ExternalResource() {
        override fun before() {
            check(InstrumentationRegistry.getInstrumentation().targetContext.packageName.let { it.endsWith(".refreshfixture") || it.endsWith(".listrefresh1319") }) { "Run only in the isolated refresh fixture package" }
            app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
            preferences = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).all.toMap()
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                savedAccess = state(AiAccess, "state", false).value
                savedAuth = state(app.authSession, "state").value
                val tokenField = AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }
                savedAuthToken = tokenField.get(app.authSession) as String?
                tokenField.set(app.authSession, token)
                state(app.authSession, "state").value = AuthSession.State.SignedIn(NuphosUser("refresh-fixture", "refresh@example.invalid", "Refresh fixture"))
                AiAccess.activate(token)
            }
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                val req = chain.request(); requests += req
                val path = req.url.encodedPath
                var code = 200
                val text = when {
                    path == "/auth/ai-consent" -> """{"version":"${AccountApi.AI_CONSENT_VERSION}","accepted":true}"""
                    path == "/teams/aaaaaaaaaaaaaaaaaaaaaaaa/favorites" -> {
                        if (failFavorites) { code = 503; "{}" }
                        else """{"revision":1,"entries":$entries}"""
                    }
                    path == "/teams/bbbbbbbbbbbbbbbbbbbbbbbb/favorites" -> """{"revision":1,"entries":[{"key":"agent-session:b","label":"Team B pin"}]}"""
                    path == "/agent/conversations" -> {
                        val title = historyTitle
                        val order = req.url.queryParameter("sort")
                        if ((holdHistory && req.url.queryParameter("cursor") == null) || (holdPage && req.url.queryParameter("cursor") != null)) {
                            holdHistory = false; holdPage = false; historyHeld.countDown()
                            check(historyRelease.await(15, TimeUnit.SECONDS))
                        }
                        if (failHistory) { code = 503; "{}" }
                        else if (sortHistory) {
                            val recent = """{"sessionId":"recent","teamId":"${req.url.queryParameter("teamId")}","title":"Older chat, recent activity","createdAt":"2026-01-01T00:00:00Z","lastActiveAt":"2026-10-22T00:00:00Z"}"""
                            val created = """{"sessionId":"created","teamId":"${req.url.queryParameter("teamId")}","title":"Newer chat, older activity","createdAt":"2026-10-01T00:00:00Z","lastActiveAt":"2026-10-02T00:00:00Z"}"""
                            val rows = if (order == "created") "$created,$recent" else "$recent,$created"
                            """{"conversations":[$rows],"nextCursor":"${order}-cursor","hasMore":false}"""
                        }
                        else if (treeHistory) """{"conversations":[{"sessionId":"parent","teamId":"aaaaaaaaaaaaaaaaaaaaaaaa","title":"Synthetic parent","isOwner":true},{"sessionId":"child","teamId":"aaaaaaaaaaaaaaaaaaaaaaaa","title":"Synthetic child","parentSessionId":"parent","isOwner":true}],"hasMore":false}"""
                        else if (emptyHistory) """{"conversations":[],"hasMore":false}""" else
                        """{"conversations":[{"sessionId":"normal","teamId":"${req.url.queryParameter("teamId")}","title":"$title"}],"hasMore":false}"""
                    }
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
            historyRelease.countDown()
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                if (::store.isInitialized) store.disposeForConsent()
                if (::fixtureAuth.isInitialized) fixtureAuth.composerDrafts.clear()
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
            state(store, "selectedTeam").value = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
            store.acceptMemberships(listOf(Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A"), Team("bbbbbbbbbbbbbbbbbbbbbbbb", "Fixture B")))
            state(store, "phase").value = AgentStore.Phase.Loaded
            state(store, "conversations").value = if (emptyHistory) emptyList<AgentConversation>() else listOf(AgentConversation("normal", "aaaaaaaaaaaaaaaaaaaaaaaa", "Normal history"))
            fixtureAuth = AuthSession(app, app.tokenStore)
            AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(fixtureAuth, token)
            state(fixtureAuth, "state").value = AuthSession.State.SignedIn(NuphosUser("refresh-fixture", "refresh@example.invalid", "Refresh fixture"))
            fixtureAuth.composerDrafts.onIdentity("refresh-fixture")
            val auth = fixtureAuth
            compose.activity.setContent {
                NuphosTheme(darkTheme = false) { CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    val nav = rememberNavController()
                    navController = nav
                    androidx.compose.runtime.SideEffect {
                        androidx.core.view.WindowCompat.getInsetsController(compose.activity.window, compose.activity.window.decorView).apply {
                            isAppearanceLightStatusBars = true
                            isAppearanceLightNavigationBars = true
                        }
                    }
                    androidx.compose.material3.Surface(Modifier.fillMaxSize()) {
                        androidx.compose.foundation.layout.Box(Modifier.systemBarsPadding()) {
                            NavHost(nav, startDestination = "history") {
                                composable("history") {
                                    androidx.compose.foundation.layout.Column {
                                        if (sortHistory) CompositionLocalProvider(LocalPlansStore provides PlansStore(token)) {
                                            ai.nuphos.android.ui.home.FilterButton(HomePage.Agent)
                                        }
                                        androidx.compose.foundation.layout.Box(Modifier.weight(1f)) {
                                            AgentPage(searching.value, { searching.value = it }, nav)
                                        }
                                    }
                                }
                                composable("fixture-detail") { androidx.compose.material3.Text("Synthetic detail") }
                            }
                        }
                    }
                } }
            }
        }
        compose.waitUntil(5_000) { !store.favoritesLoading && !store.isRefreshing }
        compose.waitUntil(5_000) {
            try { compose.onAllNodesWithTag("chat-history-refresh").fetchSemanticsNodes().isNotEmpty() }
            catch (_: IllegalStateException) { false }
        }
        compose.waitForIdle()
    }
    private fun waitText(text: String) { compose.waitUntil(5_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() } }

    private fun shot(name: String) {
        if (InstrumentationRegistry.getArguments().getString("refreshEvidence") != "true") return
        compose.waitForIdle(); Thread.sleep(350)
        val bitmap = requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
        java.io.File(app.getExternalFilesDir(null), "refresh-$name.png").outputStream().use {
            bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
    }

    private fun assertCentered(title: String) {
        val viewport = compose.onNodeWithTag("chat-history-refresh").fetchSemanticsNode().boundsInRoot
        val label = compose.onNodeWithText(title).fetchSemanticsNode().boundsInRoot
        assertTrue("Empty/error content should remain centered in the viewport",
            kotlin.math.abs(label.center.y - viewport.center.y) < viewport.height * 0.2f)
    }
    private fun hideKeyboard() {
        compose.runOnIdle {
            val keyboard = compose.activity.getSystemService(Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
            keyboard.hideSoftInputFromWindow(compose.activity.window.decorView.windowToken, 0)
        }
    }

    private fun historyReads() = requests.count { it.url.encodedPath == "/agent/conversations" }
    private fun pinReads() = requests.count { it.url.encodedPath == "/teams/aaaaaaaaaaaaaaaaaaaaaaaa/favorites" }
    private fun pull() {
        compose.onNodeWithTag("chat-history-refresh").performTouchInput {
            swipeDown(startY = height * 0.1f, endY = height * 0.95f, durationMillis = 700)
        }
    }
    private fun settled() { compose.waitUntil(10_000) { !store.isRefreshing && store.phase != AgentStore.Phase.Loading } }

    @Test fun initialRefreshShowsOnlyTheCenteredLoadingIndicator() {
        render()
        holdHistory = true
        compose.runOnIdle {
            state(store, "phase").value = AgentStore.Phase.Loading
            state(store, "conversations").value = emptyList<AgentConversation>()
            store.refresh()
        }
        assertTrue(historyHeld.await(5, TimeUnit.SECONDS))
        waitText("Loading agents…")
        compose.onAllNodes(SemanticsMatcher.keyIsDefined(
            androidx.compose.ui.semantics.SemanticsProperties.ProgressBarRangeInfo), useUnmergedTree = true)
            .assertCountEquals(1)
        shot("initial-single-indicator")
        historyRelease.countDown()
        settled()
        waitText("Normal history")
        compose.onNodeWithText("Loading agents…").assertDoesNotExist()
    }

    @Test fun resumeReadsNewRemoteHistoryAndPinsWithoutRelaunch() {
        render()
        val reads = historyReads()
        compose.activityRule.scenario.moveToState(androidx.lifecycle.Lifecycle.State.STARTED)
        historyTitle = "Created on another client"
        entries = entries.replace("Beyond first page", "Remote pinned chat")
        compose.activityRule.scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED)
        waitText("Created on another client"); waitText("Remote pinned chat"); settled()
        assertEquals(reads + 1, historyReads())
        shot("resume-remote-light")
    }

    @Test fun resumeSupersedesReadStartedBeforeBackgrounding() {
        render()
        holdHistory = true; historyTitle = "Pre-background snapshot"
        compose.runOnIdle { store.refresh() }
        assertTrue(historyHeld.await(5, TimeUnit.SECONDS))
        compose.activityRule.scenario.moveToState(androidx.lifecycle.Lifecycle.State.STARTED)
        historyTitle = "Latest remote snapshot"
        compose.activityRule.scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED)
        waitText("Latest remote snapshot"); settled()
        historyRelease.countDown()
        Thread.sleep(200); compose.waitForIdle()
        compose.onNodeWithText("Pre-background snapshot").assertDoesNotExist()
        compose.onNodeWithText("Latest remote snapshot").assertExists()
        shot("resume-inflight-light")
    }

    @Test fun returningFromDetailRefreshesCurrentSearchAndArchiveScope() {
        render()
        compose.runOnIdle { store.updateSort(ConversationSort.Activity); store.updateScope(ConversationScope.Team); store.updateSearch("needle"); store.updateArchivedOnly(true) }
        Thread.sleep(350); settled()
        compose.runOnIdle { navController.navigate("fixture-detail") }
        waitText("Synthetic detail")
        val reads = historyReads()
        historyTitle = "Remote archived result"
        compose.runOnIdle { navController.popBackStack() }
        waitText("Remote archived result"); settled()
        assertEquals(reads + 1, historyReads())
        val last = requests.last { it.url.encodedPath == "/agent/conversations" }
        assertEquals("activity", last.url.queryParameter("sort"))
        assertEquals("needle", last.url.queryParameter("search"))
        assertEquals("team", last.url.queryParameter("scope"))
        assertEquals("only", last.url.queryParameter("archived"))
        shot("return-filtered-light")
    }

    @Test fun actualGestureRefreshesHistoryAndPinsAndFailureCanRetry() {
        render()
        shot("before-light")
        if (InstrumentationRegistry.getArguments().getString("refreshVideo") == "true") Thread.sleep(5000)
        val reads = historyReads(); val pins = pinReads()
        historyTitle = "Fresh history"
        entries = entries.replace("Beyond first page", "Refreshed pin")
        pull(); waitText("Fresh history"); settled(); shot("success-light")
        assertEquals(reads + 1, historyReads()); assertEquals(pins + 1, pinReads())
        failHistory = true; failFavorites = true
        pull(); waitText("Could not refresh agents. Showing last loaded history."); settled()
        shot("failed-retains-light")
        compose.onNodeWithText("Fresh history").assertExists()
        compose.onNodeWithText("Refreshed pin").assertExists()
        failHistory = false; failFavorites = false; historyTitle = "Recovered history"
        pull(); waitText("Recovered history"); settled(); shot("retry-light")
        if (InstrumentationRegistry.getArguments().getString("refreshVideo") == "true") Thread.sleep(3000)
        assertNull(store.phaseError); assertNull(store.favoritesError)
    }

    @Test fun emptyAndSearchAndArchivedStillAcceptGestureAndKeepFilters() {
        emptyHistory = true; entries = "[]"; render()
        waitText("No agents yet"); assertCentered("No agents yet"); shot("empty-light")
        var reads = historyReads()
        pull(); compose.waitUntil(5_000) { historyReads() > reads }; settled()
        compose.runOnIdle { store.updateScope(ConversationScope.Team); searching.value = true }
        compose.onNodeWithText("Search agents").performTextInput("needle")
        compose.runOnIdle { store.updateArchivedOnly(true) }
        hideKeyboard()
        waitText("No matches")
        // Let the debounced search finish before measuring a manual refresh.
        Thread.sleep(350); compose.waitForIdle()
        reads = historyReads(); pull()
        compose.waitUntil(5_000) { historyReads() > reads }; settled()
        shot("filters-light")
        assertEquals("needle", store.search); assertTrue(store.archivedOnly); assertEquals(ConversationScope.Team, store.scope)
        val last = requests.last { it.url.encodedPath == "/agent/conversations" }
        assertEquals("needle", last.url.queryParameter("search"))
        assertEquals("team", last.url.queryParameter("scope"))
        assertEquals("only", last.url.queryParameter("archived"))
    }

    @Test fun repeatedRefreshAndPaginationAreBlockedAndLateWorkspaceResultIsRejected() {
        render()
        holdHistory = true; historyTitle = "Late A history"
        compose.runOnIdle { store.refresh() }
        assertTrue(historyHeld.await(5, TimeUnit.SECONDS))
        shot("refreshing-light")
        val reads = historyReads()
        compose.runOnIdle {
            store.refresh()
            state(store, "hasMore").value = true
            AgentStore::class.java.getDeclaredField("nextCursor").also { it.isAccessible = true }.set(store, "cursor")
        }
        runBlocking(Dispatchers.Main) { store.loadMore() }
        assertEquals(reads, historyReads())
        historyTitle = "Team B history"
        compose.runOnIdle { store.select(Team("bbbbbbbbbbbbbbbbbbbbbbbb", "Fixture B")) }
        waitText("Team B history")
        historyRelease.countDown(); settled()
        compose.onNodeWithText("Late A history").assertDoesNotExist()
        assertEquals("bbbbbbbbbbbbbbbbbbbbbbbb", store.selectedTeam?.id)
    }

    @Test fun initialErrorSurfaceCanPullToRecoverAndAccountRevocationRejectsHeldRead() {
        emptyHistory = true; entries = "[]"; render()
        compose.runOnIdle { state(store, "phase").value = AgentStore.Phase.Failed }
        waitText("Couldn't load agents"); assertCentered("Couldn't load agents"); shot("initial-error-light")
        emptyHistory = false; historyTitle = "Recovered from initial error"
        pull(); waitText("Recovered from initial error"); settled()
        holdHistory = true; historyTitle = "Wrong account response"
        compose.runOnIdle { store.refresh() }
        assertTrue(historyHeld.await(5, TimeUnit.SECONDS))
        compose.runOnIdle { AiAccess.activate("different-account"); AiAccess.grant("different-account") }
        historyRelease.countDown()
        compose.waitUntil(5_000) { !store.isRefreshing }
        compose.onNodeWithText("Wrong account response").assertDoesNotExist()
        assertTrue(store.conversations.isEmpty())
    }

    @Test fun refreshingPreservesTreeFoldAndUnsentComposerDraft() {
        treeHistory = true; entries = "[]"; render()
        compose.runOnIdle { store.refresh() }
        waitText("Synthetic child"); settled()
        compose.onNodeWithContentDescription("Hide 1 sub-agents").performClick()
        compose.onNodeWithText("Synthetic child").assertDoesNotExist()
        compose.onNode(hasSetTextAction()).performTextInput("Unsent refresh fixture draft")
        compose.onNodeWithText("Unsent refresh fixture draft").assertExists()
        hideKeyboard()
        pull(); settled()
        compose.onNodeWithText("Synthetic child").assertDoesNotExist()
        compose.onNodeWithText("Unsent refresh fixture draft").assertExists()
        shot("fold-draft-light")
    }

    @Test fun aPageAlreadyInFlightCannotAppendOverNewFirstPage() {
        render()
        val work = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        holdPage = true; historyTitle = "Stale cursor page"
        compose.runOnIdle {
            state(store, "hasMore").value = true
            AgentStore::class.java.getDeclaredField("nextCursor").also { it.isAccessible = true }.set(store, "cursor")
            work.launch { store.loadMore() }
        }
        assertTrue(historyHeld.await(5, TimeUnit.SECONDS))
        historyTitle = "Fresh first page"
        compose.runOnIdle { store.refresh() }
        waitText("Fresh first page"); settled()
        historyRelease.countDown()
        compose.waitUntil(5_000) { work.coroutineContext[Job]?.children?.none() == true }
        compose.onNodeWithText("Stale cursor page").assertDoesNotExist()
        assertEquals(1, store.conversations.size)
        assertEquals(1, requests.count { it.url.queryParameter("cursor") != null })
        work.cancel()
    }

    @Test fun cancelledInitialReadEndsLoadingAndCanBeRetried() {
        emptyHistory = true; entries = "[]"; render()
        val work = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        holdHistory = true
        compose.runOnIdle {
            state(store, "phase").value = AgentStore.Phase.Idle
            work.launch { store.reload() }
        }
        assertTrue(historyHeld.await(5, TimeUnit.SECONDS))
        work.cancel(); historyRelease.countDown()
        waitText("Couldn't load agents")
        assertEquals(AgentStore.Phase.Failed, store.phase)
        assertFalse(store.isRefreshing)
        emptyHistory = false; historyTitle = "Recovered interrupted refresh"
        pull(); waitText("Recovered interrupted refresh"); settled()
    }
    @Test fun sortMenuChangesOrderAndResetsCursorWithPinsAndFiltersIntact() {
        sortHistory = true; render()
        compose.runOnIdle { store.refresh() }
        waitText("Newer chat, older activity"); settled()
        assertEquals(ConversationSort.Created, store.sort)
        assertEquals(listOf("created", "recent"), store.conversations.map { it.sessionId })
        compose.onNodeWithContentDescription("Filter agents").performClick()
        compose.onNodeWithText("Date created").assertIsSelected()
        shot("sort-menu-created-light")
        compose.onNodeWithText("Recent activity").performClick()
        compose.waitUntil(5_000) { store.conversations.firstOrNull()?.sessionId == "recent" }
        assertEquals(ConversationSort.Activity, store.sort)
        assertEquals(listOf("recent", "created"), store.conversations.map { it.sessionId })
        val last = requests.last { it.url.encodedPath == "/agent/conversations" }
        assertEquals("activity", last.url.queryParameter("sort"))
        assertNull(last.url.queryParameter("cursor"))
        compose.onNodeWithText("Beyond first page").assertExists()
        shot("sort-activity-light")
        compose.runOnIdle { state(store, "hasMore").value = true }
        runBlocking(Dispatchers.Main) { store.loadMore() }
        assertEquals("activity-cursor", requests.last { it.url.encodedPath == "/agent/conversations" }.url.queryParameter("cursor"))
        assertEquals(listOf("recent", "created"), store.conversations.map { it.sessionId })
        compose.runOnIdle { store.updateScope(ConversationScope.Team); store.updateSearch("needle"); store.updateArchivedOnly(true) }
        Thread.sleep(350); settled()
        compose.runOnIdle { store.updateSort(ConversationSort.Created) }
        compose.waitUntil(5_000) { store.conversations.firstOrNull()?.sessionId == "created" }
        val filtered = requests.last { it.url.encodedPath == "/agent/conversations" }
        assertEquals("created", filtered.url.queryParameter("sort"))
        assertEquals("needle", filtered.url.queryParameter("search"))
        assertEquals("team", filtered.url.queryParameter("scope"))
        assertEquals("only", filtered.url.queryParameter("archived"))
        assertNull(filtered.url.queryParameter("cursor"))
    }

    @Test fun oldCursorResponseCannotAppendAfterSortChange() {
        sortHistory = true; render()
        compose.runOnIdle { store.refresh() }; settled()
        compose.waitUntil(5_000) { store.conversations.firstOrNull()?.sessionId == "created" }
        val work = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        try {
            holdPage = true
            compose.runOnIdle { state(store, "hasMore").value = true; work.launch { store.loadMore() } }
            assertTrue(historyHeld.await(5, TimeUnit.SECONDS))
            compose.runOnIdle { store.updateSort(ConversationSort.Activity) }
            compose.waitUntil(5_000) { store.conversations.firstOrNull()?.sessionId == "recent" }
            historyRelease.countDown()
            compose.waitUntil(5_000) { work.coroutineContext[Job]?.children?.none() == true }
            assertEquals(listOf("recent", "created"), store.conversations.map { it.sessionId })
            assertFalse(store.isLoadingMore)
            assertEquals(ConversationSort.Activity, store.sort)
        } finally { historyRelease.countDown(); work.cancel() }
    }

    @Test fun refreshStartedInOldOrderCannotReplaceSortSelection() {
        sortHistory = true; render()
        compose.runOnIdle { store.refresh() }; settled()
        holdHistory = true
        compose.runOnIdle { store.refresh() }
        assertTrue(historyHeld.await(5, TimeUnit.SECONDS))
        compose.runOnIdle { store.updateSort(ConversationSort.Activity) }
        compose.waitUntil(5_000) { store.conversations.firstOrNull()?.sessionId == "recent" }
        historyRelease.countDown(); settled()
        assertEquals(listOf("recent", "created"), store.conversations.map { it.sessionId })
        compose.activityRule.scenario.moveToState(androidx.lifecycle.Lifecycle.State.STARTED)
        compose.activityRule.scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED)
        compose.waitUntil(5_000) { !store.isRefreshing }
        assertEquals("activity", requests.last { it.url.encodedPath == "/agent/conversations" }.url.queryParameter("sort"))
        assertEquals(ConversationSort.Activity, store.sort)
    }

}
