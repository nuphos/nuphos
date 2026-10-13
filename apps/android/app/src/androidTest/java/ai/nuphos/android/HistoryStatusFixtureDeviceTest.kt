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
class HistoryStatusFixtureDeviceTest {
    private val compose = createAndroidComposeRule<MainActivity>()
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
    private val network = object : ExternalResource() {
        override fun before() {
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
                    "/teams/A/favorites", "/teams/B/favorites" -> """{"revision":1,"entries":[]}"""
                    "/agent/auto-mode/bypass" -> """{"bypass":false}"""
                    "/agent/conversations" -> {
                        val team = req.url.queryParameter("teamId") ?: "A"
                        val snapshot = row(listActivity).copy(teamId = team, title = if (team == "A") listTitle else "Team B history",
                            readSeq = JsonValue.Number(listRead.toDouble()), unread = JsonValue.Bool(owner && listActivity > listRead),
                            runtimeState = if (backgroundPhase) JsonValue.parse("""{"schemaVersion":2,"state":"active","phase":"background_tools","epoch":"a","revision":2}""") else row().runtimeState)
                        val fail = failList
                        if (holdNextList) { holdNextList = false; listHeld.countDown(); check(listRelease.await(10, TimeUnit.SECONDS)) }
                        if (req.url.queryParameter("cursor") == "following-page") { followingHeld.countDown(); check(followingRelease.await(10, TimeUnit.SECONDS)) }
                        if (fail) { code = 503; "{}" } else Http.json.encodeToString(AgentConversationsPage.serializer(), AgentConversationsPage(listOf(snapshot)))
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
    private fun render(expectHistory: Boolean = true) {
        compose.runOnIdle {
            AiAccess.grant(token)
            store = AgentStore(token, compose.activity)
            state(store, "selectedTeam").value = Team("A", "Fixture A")
            store.acceptMemberships(listOf(Team("A", "Fixture A"), Team("B", "Fixture B")))
            state(store, "phase").value = AgentStore.Phase.Idle
            auth = AuthSession(app, app.tokenStore)
            AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
            compose.activity.setContent {
                NuphosTheme { CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    val nav = rememberNavController()
                    NavHost(nav, startDestination = "history") {
                        composable("history") { AgentPage(false, {}, nav) }
                        composable("conversation/{sessionId}") { back ->
                            ConversationScreen(back.arguments!!.getString("sessionId")!!, false, { nav.popBackStack() }, nav)
                        }
                    }
                } }
            }
        }
        compose.runOnIdle { work.launch { store.reload() } }
        waitText(if (expectHistory) "History fixture" else "Couldn't load chats")
    }
    private fun waitText(text: String) { compose.waitUntil(5_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() } }
    private fun readCount() = requests.count { it.url.encodedPath.endsWith("/read") }
    @Test fun listIndicatorExpiresAndOnlyDisplayedOwnerAcknowledges() {
        render()
        compose.onNodeWithText("Running").assertIsDisplayed()
        assertEquals(0, readCount())
        android.os.SystemClock.sleep(12_100)
        compose.waitUntil(15_000) { compose.onAllNodesWithText("Running").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithText("Unread").assertIsDisplayed()
        compose.onNodeWithText("History fixture").performClick()
        waitText("Displayed owner transcript")
        compose.waitUntil(5_000) { readCount() == 1 }
        compose.waitUntil(5_000) { !HistoryStatus.unread(store.conversations.single()) }
    }
    private fun refresh(): Job {
        lateinit var job: Job
        compose.runOnIdle { job = work.launch { store.reload() } }
        return job
    }
    private fun assertKnownRequests() {
        val allowed = setOf("/teams/A/favorites", "/teams/B/favorites", "/agent/auto-mode/bypass", "/agent/conversations", "/agent/conversations/saved", "/agent/conversations/saved/read")
        assertTrue(requests.filter { it.header("Authorization") == "Bearer $token" }.all { it.url.encodedPath in allowed })
    }
    @Test fun activeBackgroundAndUnreadStillShowsRunning() {
        backgroundPhase = true; render()
        compose.onNodeWithText("Running").assertIsDisplayed()
        compose.onNodeWithText("Background tools").assertDoesNotExist()
        compose.onNodeWithText("Unread").assertDoesNotExist()
        assertKnownRequests()
    }
    @Test fun failedRefreshRetainsHistoryWithRetryAndExpiredRuntime() {
        render(); failList = true
        val job = refresh()
        compose.waitUntil(5_000) { job.isCompleted }
        waitText("Could not refresh chats. Showing last loaded history.")
        compose.onNodeWithText("History fixture").assertIsDisplayed()
        compose.onNodeWithText("Couldn't load chats").assertDoesNotExist()
        android.os.SystemClock.sleep(12_100)
        compose.waitUntil(15_000) { compose.onAllNodesWithText("Running").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithText("Unread").assertIsDisplayed()
        failList = false
        compose.onNodeWithText("Retry history").performClick()
        compose.waitUntil(5_000) { store.phaseError == null }
        compose.onNodeWithText("Running").assertIsDisplayed()
        assertKnownRequests()
    }
    @Test fun initialFailureHasNoRetainedHistoryBanner() {
        failList = true; render(expectHistory = false)
        compose.onNodeWithText("Couldn't load chats").assertIsDisplayed()
        compose.onNodeWithText("History fixture").assertDoesNotExist()
        compose.onNodeWithText("Retry history").assertDoesNotExist()
        assertKnownRequests()
    }
    @Test fun queryTransitionsDropUnrelatedRetainedRows() {
        render(); failList = true
        compose.runOnIdle { store.updateSearch("different"); assertTrue(store.conversations.isEmpty()) }
        waitText("Couldn't load chats")
        compose.onNodeWithText("History fixture").assertDoesNotExist()
        compose.runOnIdle { store.updateScope(ConversationScope.Team); assertTrue(store.conversations.isEmpty()) }
        waitText("Couldn't load chats")
        compose.runOnIdle { store.updateArchivedOnly(true); assertTrue(store.conversations.isEmpty()) }
        waitText("Couldn't load chats")
        compose.onNodeWithText("Retry history").assertDoesNotExist()
        assertKnownRequests()
    }
    private fun delayedListAfterRead(newer: Boolean) {
        render(); holdNextList = true
        val job = refresh()
        compose.waitUntil(5_000) { listHeld.count == 0L }
        if (newer) readActivity = 8
        compose.onNodeWithText("History fixture").performClick(); waitText("Displayed owner transcript")
        compose.waitUntil(5_000) { HistoryStatus.sequence(store.conversations.single().readSeq) == 4L }
        if (newer) assertEquals(8L, HistoryStatus.sequence(store.conversations.single().activitySeq))
        listRelease.countDown()
        compose.waitUntil(5_000) { job.isCompleted }
        assertEquals(4L, HistoryStatus.sequence(store.conversations.single().readSeq))
        assertEquals(if (newer) 8L else 4L, HistoryStatus.sequence(store.conversations.single().activitySeq))
        assertEquals(newer, HistoryStatus.unread(store.conversations.single()))
        assertKnownRequests()
    }
    @Test fun heldListCannotUndoConfirmedOwnerRead() = delayedListAfterRead(false)
    @Test fun heldListCannotEraseNewerUnreadActivity() = delayedListAfterRead(true)
    @Test fun heldLoadMoreCannotUndoConfirmedOwnerRead() {
        render()
        compose.runOnIdle {
            holdNextList = true
            AgentStore::class.java.getDeclaredField("nextCursor").also { it.isAccessible = true }.set(store, "next")
            state(store, "hasMore").value = true
            work.launch { store.loadMore() }
        }
        compose.waitUntil(5_000) { listHeld.count == 0L }
        compose.onNodeWithText("History fixture").performClick(); waitText("Displayed owner transcript")
        compose.waitUntil(5_000) { HistoryStatus.sequence(store.conversations.single().readSeq) == 4L }
        listRelease.countDown()
        compose.waitUntil(5_000) { !store.isLoadingMore }
        assertEquals(1, store.conversations.size)
        assertEquals(4L, HistoryStatus.sequence(store.conversations.single().readSeq))
        assertFalse(HistoryStatus.unread(store.conversations.single()))
        assertKnownRequests()
    }
    @Test fun refreshSupersedesHeldPaginationWithoutBlockingNextPage() {
        render()
        lateinit var oldPage: Job
        compose.runOnIdle {
            holdNextList = true
            AgentStore::class.java.getDeclaredField("nextCursor").also { it.isAccessible = true }.set(store, "held-page")
            state(store, "hasMore").value = true
            oldPage = work.launch { store.loadMore() }
        }
        compose.waitUntil(5_000) { listHeld.count == 0L }
        assertTrue(store.isLoadingMore)
        val refreshed = refresh()
        compose.waitUntil(5_000) { refreshed.isCompleted }
        assertFalse("Refresh must release the superseded pagination flag", store.isLoadingMore)
        val before = requests.count { it.url.encodedPath == "/agent/conversations" }
        compose.runOnIdle {
            AgentStore::class.java.getDeclaredField("nextCursor").also { it.isAccessible = true }.set(store, "following-page")
            state(store, "hasMore").value = true
            work.launch { store.loadMore() }
        }
        compose.waitUntil(5_000) { followingHeld.count == 0L }
        assertTrue(store.isLoadingMore)
        listRelease.countDown()
        compose.waitUntil(5_000) { oldPage.isCompleted }
        assertTrue("Obsolete completion must not clear the newer page flag", store.isLoadingMore)
        followingRelease.countDown()
        compose.waitUntil(5_000) {
            requests.count { it.url.encodedPath == "/agent/conversations" } > before && !store.isLoadingMore
        }
        assertKnownRequests()
    }
    @Test fun teamRoundTripRejectsLateListAndResetsReadProgress() {
        render()
        compose.onNodeWithText("History fixture").performClick(); waitText("Displayed owner transcript")
        compose.waitUntil(5_000) { HistoryStatus.sequence(store.conversations.single().readSeq) == 4L }
        compose.onNodeWithContentDescription("Back").performClick(); waitText("History fixture")
        holdNextList = true
        val job = refresh()
        compose.waitUntil(5_000) { listHeld.count == 0L }
        compose.runOnIdle { store.select(Team("B", "Fixture B")); assertTrue(store.conversations.isEmpty()); assertNull(store.phaseError) }
        waitText("Team B history")
        compose.onNodeWithText("History fixture").assertDoesNotExist()
        listTitle = "Returned A history"
        compose.runOnIdle { store.select(Team("A", "Fixture A")); assertTrue(store.conversations.isEmpty()) }
        waitText("Returned A history")
        listRelease.countDown()
        compose.waitUntil(5_000) { job.isCompleted }
        assertEquals("A", store.conversations.single().teamId)
        assertEquals("Returned A history", store.conversations.single().title)
        assertEquals(1L, HistoryStatus.sequence(store.conversations.single().readSeq))
        assertKnownRequests()
    }
    @Test fun sharedTranscriptNeverAcknowledges() {
        owner = false; render()
        compose.onNodeWithText("History fixture").performClick(); waitText("Displayed owner transcript")
        compose.mainClock.advanceTimeBy(2_000); compose.waitForIdle()
        assertEquals(0, readCount())
    }
    @Test fun failedTranscriptNeverAcknowledges() {
        failDetail = true; render()
        compose.onNodeWithText("History fixture").performClick()
        compose.waitUntil(5_000) { requests.any { it.url.encodedPath == "/agent/conversations/saved" } }
        compose.mainClock.advanceTimeBy(2_000); compose.waitForIdle()
        assertEquals(0, readCount())
        assertTrue(HistoryStatus.unread(store.conversations.single()))
    }
    @Test fun failedReadRetriesOnceAndRetainsUnread() {
        failRead = true; render()
        compose.onNodeWithText("History fixture").performClick(); waitText("Displayed owner transcript")
        compose.waitUntil(5_000) { readCount() == 2 }
        compose.mainClock.advanceTimeBy(6_000); compose.waitForIdle()
        assertEquals(2, readCount())
        assertTrue(HistoryStatus.unread(store.conversations.single()))
    }
    @Test fun newerListActivitySurvivesOlderAcknowledgement() {
        holdRead = true; render()
        compose.onNodeWithText("History fixture").performClick(); waitText("Displayed owner transcript")
        assertTrue(held.await(5, TimeUnit.SECONDS))
        compose.runOnIdle { state(store, "conversations").value = listOf(row(8)) }
        release.countDown()
        compose.waitUntil(5_000) { HistoryStatus.sequence(store.conversations.single().readSeq) == 4L }
        assertTrue(HistoryStatus.unread(store.conversations.single()))
    }
    @Test fun backgroundTranscriptDoesNotAcknowledgeUntilResumed() {
        holdDetail = true; render()
        compose.onNodeWithText("History fixture").performClick()
        compose.waitUntil(5_000) { detailHeld.count == 0L }
        compose.activityRule.scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED)
        detailRelease.countDown()
        assertTrue(detailReturned.await(5, TimeUnit.SECONDS))
        android.os.SystemClock.sleep(500)
        assertEquals(0, readCount())
        compose.activityRule.scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED)
        waitText("Displayed owner transcript")
        compose.waitUntil(5_000) { readCount() == 1 }
    }
    @Test fun navigationDiscardsLateAcknowledgement() {
        holdRead = true; render()
        compose.onNodeWithText("History fixture").performClick(); waitText("Displayed owner transcript")
        assertTrue(held.await(5, TimeUnit.SECONDS))
        compose.onNodeWithContentDescription("Back").performClick()
        release.countDown(); compose.waitForIdle()
        assertTrue(HistoryStatus.unread(store.conversations.single()))
    }
}
