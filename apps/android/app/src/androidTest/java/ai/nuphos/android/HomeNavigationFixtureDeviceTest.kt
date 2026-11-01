package ai.nuphos.android

import android.content.res.Configuration
import android.util.DisplayMetrics
import android.content.Context
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.test.espresso.Espresso
import androidx.compose.ui.input.key.Key
import android.graphics.Bitmap
import java.io.File
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.*
import ai.nuphos.android.model.*
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.*
import ai.nuphos.android.ui.home.HomeScreen
import ai.nuphos.android.ui.theme.NuphosTheme
import ai.nuphos.android.ui.workspace.WorkspaceSetupSheet
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.serialization.builtins.ListSerializer
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** All responses are synthetic. Unknown requests fail; this client never opens a socket. */
@RunWith(AndroidJUnit4::class)
class HomeNavigationFixtureDeviceTest {
    private val compose = createComposeRule()
    private val a = Team("507f1f77bcf86cd799439011", "Fixture Alpha", role = "ADMINISTRATOR", isOwner = true)
    private val b = Team("507f1f77bcf86cd799439012", "Fixture Beta", role = "EDITOR", isOwner = false)
    private val token = "workspace-synthetic-no-credentials"
    private val requests = CopyOnWriteArrayList<Request>()
    private val unexpected = CopyOnWriteArrayList<Request>()
    @Volatile private var memberships = emptyList<Team>()
    private lateinit var savedConfiguration: Configuration
    private lateinit var savedMetrics: DisplayMetrics
    @Volatile private var restoreFailure = false
    @Volatile private var restored = false
    @Volatile private var historyFailure = false
    @Volatile private var runtimeCatalogHold: CountDownLatch? = null
    @Volatile private var runtimeCatalogFailure = false
    @Volatile private var runtimeRemoved = false
    private lateinit var plansStore: PlansStore
    private lateinit var app: NuphosApplication
    private lateinit var agent: AgentStore
    private lateinit var auth: AuthSession
    private var savedAccess: Any? = null
    private lateinit var savedAuth: AuthSession
    private var savedLastTeam: String? = null
    private val originals = mutableMapOf<String, OkHttpClient>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    @Suppress("UNCHECKED_CAST") private fun state(target: Any, name: String, delegated: Boolean = true) =
        target.javaClass.getDeclaredField(name + if (delegated) "\$delegate" else "").also { it.isAccessible = true }.get(target) as MutableState<Any?>
    private val network = object : ExternalResource() {
        override fun before() {
            require(InstrumentationRegistry.getInstrumentation().targetContext.packageName in setOf("ai.nuphos.android.navigation1371", "ai.nuphos.android.runtimes1373", "ai.nuphos.android.agentsaudit1382"))
            app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
            savedConfiguration = Configuration(app.resources.configuration)
            savedMetrics = DisplayMetrics().also { it.setTo(app.resources.displayMetrics) }
            savedAuth = app.authSession
            savedLastTeam = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).getString("nuphos.workspace.lastTeamId", null)
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                savedAccess = state(AiAccess, "state", false).value
                AiAccess.activate(token); AiAccess.grant(token)
                auth = AuthSession(app, app.tokenStore)
                AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
                state(auth, "state").value = AuthSession.State.SignedIn(NuphosUser.preview)
                NuphosApplication::class.java.getDeclaredField("authSession").also { it.isAccessible = true }.set(app, auth)
            }
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                val request = chain.request(); requests += request
                val path = request.url.encodedPath
                val runtimeCatalog = request.method == "GET" && path in setOf("/teams/${a.id}/agent-runtimes", "/teams/${b.id}/agent-runtimes")
                val runtimeQuotas = request.method == "GET" && path in setOf("/teams/${a.id}/agent-runtimes/quota", "/teams/${b.id}/agent-runtimes/quota")
                val devices = request.method == "GET" && path == "/agent/devices" && request.url.queryParameter("teamId") in setOf(a.id,b.id)
                val teamRead = request.method == "GET" && path == "/teams"
                val discovery = request.method == "GET" && path == "/teams/discoverable"
                val favorites = request.method == "GET" && path in setOf("/teams/${a.id}/favorites", "/teams/${b.id}/favorites")
                val restore = request.method == "PATCH" && path == "/agent/conversations/fixture-chat/archive" && request.url.queryParameter("teamId") == a.id
                val detail = request.method == "GET" && path == "/agent/conversations/fixture-chat" && request.url.queryParameter("teamId") == a.id
                val credentials = request.method == "GET" && path == "/agent/credential-options"
                val consent = request.method == "GET" && path == "/auth/ai-consent"
                val connectors = request.method == "GET" && path in setOf("/teams/${a.id}/connectors", "/teams/${b.id}/connectors")
                val history = request.method == "GET" && path == "/agent/conversations" && request.url.queryParameter("teamId") in setOf(a.id, b.id)
                val plans = request.method == "GET" && path == "/agent/plans" && request.url.queryParameter("teamId") in setOf(a.id, b.id)
                val members = request.method == "GET" && path in setOf("/teams/${a.id}/members", "/teams/${b.id}/members")
                val browsing = request.method == "GET" && path in setOf("/teams/${a.id}/monitoring/overview", "/teams/${a.id}/agent-triggers", "/teams/${a.id}/agent-triggers/scheduler-status", "/teams/${b.id}/monitoring/overview", "/teams/${b.id}/agent-triggers", "/teams/${b.id}/agent-triggers/scheduler-status")
                val policy = request.method == "GET" && path == "/agent/plan-approval-policy" && request.url.queryParameter("teamId") in setOf(a.id, b.id)
                if (!runtimeCatalog && !runtimeQuotas && !devices && !teamRead && !discovery && !favorites && !history && !consent && !connectors && !plans && !members && !policy && !browsing && !credentials && !restore && !detail) unexpected += request
                var code = 200
                val body = when {
                    runtimeCatalog -> {
                        check(runtimeCatalogHold?.await(15, TimeUnit.SECONDS) != false)
                        if (runtimeCatalogFailure) { code = 503; "{}" } else if (runtimeRemoved) "{\"runtimes\":[]}" else """{"runtimes":[{"id":"synthetic-cloud","provider":"codex","label":"Synthetic Cloud","status":"active","kind":"managed"}]}"""
                    }
                    runtimeQuotas -> """{"quotas":[]}"""
                    devices -> """{"devices":[]}"""
                    teamRead -> { """{"teams":${Http.json.encodeToString(ListSerializer(Team.serializer()), memberships)}}""" }
                    discovery -> "{\"teams\":[]}"
                    restore -> {
                        val body = okio.Buffer().also { request.body!!.writeTo(it) }.readUtf8()
                        check(JsonValue.parse(body)?.get("archived")?.boolValue == false)
                        if (restoreFailure) { code = 503; "{}" } else { restored = true; "{\"ok\":true,\"archived\":false}" }
                    }
                    detail -> """{"sessionId":"fixture-chat","title":"Synthetic archived conversation","archivedAt":"2026-01-02T00:00:00Z","canManage":true,"isOwner":true,"messages":[]}"""
                    credentials -> "{}"
                    consent -> """{"version":"2026-09-28","accepted":true}"""
                    connectors -> "{}"
                    favorites -> """{"entries":[],"revision":0}"""
                    history -> {
                        if (historyFailure) { code = 403; "{}" } else if (restored && request.url.queryParameter("archived") == "only") "{\"conversations\":[],\"nextCursor\":null}" else {
                            val archived = request.url.queryParameter("archived") == "only"
                            val title = if (archived) "Synthetic archived conversation" else "Synthetic active conversation"
                            """{"conversations":[{"sessionId":"fixture-chat","teamId":"${request.url.queryParameter("teamId")}","title":"$title","archivedAt":${if (archived) "\"2026-01-02T00:00:00Z\"" else "null"},"canManage":true,"isOwner":true,"createdAt":"2026-01-01T00:00:00Z"}],"nextCursor":null}"""
                        }
                    }
                    browsing -> if (path.endsWith("agent-triggers")) "{\"triggers\":[]}" else "{}"
                    plans -> """{"plans":[],"hasMore":false}"""
                    members -> """{"members":[]}"""
                    policy -> """{"requesterApprovalRequired":true,"minimumOtherApprovals":0}"""
                    else -> { code = 500; "{}" }
                }
                Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
                    .body(body.toResponseBody(Http.jsonMedia)).build()
            }.build()
            for (name in listOf("client", "chatClient")) {
                val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
                originals[name] = field.get(null) as OkHttpClient; field.set(null, client)
            }
        }
        override fun after() {
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                if (::agent.isInitialized) agent.disposeForConsent()
                scope.cancel()
                @Suppress("DEPRECATION")
                app.resources.updateConfiguration(savedConfiguration, savedMetrics)
                NuphosApplication::class.java.getDeclaredField("authSession").also { it.isAccessible = true }.set(app, savedAuth)
                state(AiAccess, "state", false).value = savedAccess
                app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).edit().apply {
                    if (savedLastTeam == null) remove("nuphos.workspace.lastTeamId") else putString("nuphos.workspace.lastTeamId", savedLastTeam)
                }.commit()
            }
            originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
            assertTrue("Unexpected requests: ${unexpected.map { it.method + " " + it.url }}", unexpected.isEmpty())
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(network).around(compose)
    private fun waitText(text: String) {
        compose.waitUntil(8_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    }
    private fun render(compact: Boolean = false, restoration: StateRestorationTester? = null, keyboard: Boolean = false) {
        memberships = listOf(a, b)
        compose.runOnIdle {
            if (compact) {
                // Process-local fixture resources only: popup windows must also see fontScale=2.
                val config = Configuration(app.resources.configuration).apply { fontScale = 2f }
                val metrics = DisplayMetrics().also { it.setTo(app.resources.displayMetrics); it.scaledDensity = it.density * 2f }
                @Suppress("DEPRECATION")
                app.resources.updateConfiguration(config, metrics)
            }
            agent = AgentStore(token, app); agent.acceptMemberships(memberships, a.id)
            auth.composerDrafts.onIdentity(NuphosUser.preview.id)
            plansStore = PlansStore(token)
            val browsing = BrowsingApi(token)
            val monitoring = MonitoringStore(browsing)
            val triggers = TriggersStore(browsing)
            val runs = TriggerRunsStore { team, trigger, cursor -> NuphosApi.conversations(token, team, cursor = cursor, scope = ConversationScope.Team, triggerId = trigger) }
            val connectors = ConnectorsStore(ConnectorApi(token))
            val content: @Composable () -> Unit = {
                val inputMode = LocalInputModeManager.current
                SideEffect { if (keyboard) inputMode.requestInputMode(InputMode.Keyboard) }
                val density = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(density.density, if (compact) 2f else density.fontScale),
                    LocalLayoutDirection provides if (compact) LayoutDirection.Rtl else LayoutDirection.Ltr,
                    LocalAgentStore provides agent, LocalAuthSession provides auth,
                    LocalPlansStore provides plansStore, LocalConnectorsStore provides connectors) {
                    NuphosTheme(darkTheme = InstrumentationRegistry.getArguments().getString("fixtureDark") == "true") { Box(if (compact) Modifier.width(320.dp) else Modifier) {
                        HomeScreen(NuphosUser.preview, rememberNavController(),
                            showComposer = false, newChatComposer = {})
                    } }
                }
            }
            if (restoration != null) restoration.setContent(content) else compose.setContent(content)
        }
        compose.waitUntil(8_000) { compose.onAllNodesWithTag("home-page-switcher").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("home-page-switcher").assertIsDisplayed()
    }
    private fun menu() { compose.onNodeWithTag("home-page-switcher").performClick() }
    private fun select(route: String) { menu(); compose.onNodeWithTag("home-page-$route").performScrollTo().performClick(); compose.waitForIdle() }
    private fun filter() { compose.onNodeWithTag("home-filter").performClick() }
    private fun toggleArchived() { filter(); compose.onNodeWithTag("filter-archived").performScrollTo().performClick() }
    private fun noWrites() = assertTrue(requests.none { it.method != "GET" })
    private fun shot(name: String) {
        compose.waitForIdle()
        Thread.sleep(250) // Wait for the platform popup window to draw before capturing its pixels.
        val file = File(app.getExternalFilesDir(null), "navigation-$name.png")
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        try { file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } } finally { bitmap.recycle() }
    }
    @Test fun allFourPagesSelectedAndBackReturnFocusWithoutWrites() {
        render(keyboard = true); waitText("Synthetic active conversation"); shot("normal")
        compose.onNodeWithTag("home-page-switcher").performKeyInput { pressKey(androidx.compose.ui.input.key.Key.Tab) }
        menu(); shot("menu")
        compose.onNodeWithTag("home-page-monitoring").assertDoesNotExist()
        compose.onNodeWithTag("home-page-triggers").assertDoesNotExist()
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("home-page-agent").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("home-page-agent").assertIsSelected()
        Espresso.pressBack(); compose.waitForIdle()
        compose.onNodeWithTag("home-page-menu").assertDoesNotExist()
        compose.onNodeWithTag("home-page-switcher").assertIsFocused()
        for (route in listOf("plans", "runtimes", "connectors", "agent")) {
            select(route); menu()
            compose.onNodeWithTag("home-page-$route").assertIsSelected()
            Espresso.pressBack()
        }
        assertEquals(a.id, agent.selectedTeam?.id); noWrites()
    }
    @Test fun repeatedDetailsWaitsForFreshCatalogAndDoesNotManageRemovedRuntime() {
        render(); waitText("Synthetic active conversation"); select("runtimes")
        waitText("Cloud")
        compose.onNodeWithTag("runtime-row-synthetic-cloud").performScrollTo().performClick()
        waitText("Refresh runtime")
        Espresso.pressBack(); compose.waitForIdle()
        runtimeCatalogHold = CountDownLatch(1)
        try {
            compose.onNodeWithTag("runtime-row-synthetic-cloud").performScrollTo().performClick()
            waitText("Manage runtimes")
            compose.onNodeWithText("Refresh runtime").assertDoesNotExist()
            compose.onNodeWithText("Save name").assertDoesNotExist()
            runtimeCatalogFailure = true
            runtimeCatalogHold!!.countDown()
            waitText("We could not confirm the runtime result. Refresh saved state before continuing.")
            compose.onNodeWithText("Refresh runtime").assertDoesNotExist()
            compose.onNodeWithText("Save name").assertDoesNotExist()
            runtimeCatalogFailure = false; runtimeRemoved = true
            compose.onNodeWithText("Retry runtime list").performScrollTo().performClick()
            compose.waitUntil(8_000) { compose.onAllNodesWithText("This runtime is unavailable.").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Save name").assertDoesNotExist()
            noWrites()
        } finally { runtimeCatalogHold?.countDown() }
    }
    @Test fun runtimesDestinationAndExistingManageSheetPreserveComposerSelectionAndWorkspace() {
        render(); waitText("Synthetic active conversation"); select("runtimes")
        waitText("Cloud")
        compose.onNodeWithTag("runtime-row-synthetic-cloud").performScrollTo().performClick()
        compose.waitUntil(8_000) { compose.onAllNodesWithText("Refresh runtime").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Save name").assertIsNotEnabled()
        Espresso.pressBack(); compose.waitForIdle()
        assertEquals(a.id, agent.selectedTeam?.id)
        assertNull(auth.runtimeSelections.bind(NuphosUser.preview.id, a.id).selectedId)
        select("agent"); waitText("Synthetic active conversation"); noWrites()
    }
    @Test fun archiveCheckboxQueriesAndPageSwitchRetainsFilterButPlansIsIndependent() {
        render(); waitText("Synthetic active conversation")
        compose.onNodeWithText("Archived").assertDoesNotExist()
        filter(); compose.onNodeWithTag("filter-archived").assertIsOff()
        compose.onNodeWithTag("filter-archived").performScrollTo().performClick()
        waitText("Synthetic archived conversation")
        assertTrue(requests.any { it.url.encodedPath == "/agent/conversations" && it.url.queryParameter("archived") == "only" })
        filter(); compose.onNodeWithTag("filter-archived").assertIsOn(); shot("archived-filter"); Espresso.pressBack()
        select("plans"); filter()
        compose.onNodeWithText("Show dismissed").assertIsDisplayed()
        compose.onNodeWithTag("filter-archived").assertDoesNotExist(); Espresso.pressBack()
        select("agent"); filter(); compose.onNodeWithTag("filter-archived").assertIsOn(); Espresso.pressBack()
        toggleArchived(); waitText("Synthetic active conversation"); noWrites()
    }
    @Test fun searchResetTeamSwitchAndSortPreserveArchive() {
        render(); waitText("Synthetic active conversation")
        filter(); compose.onNodeWithText("Team agents").performClick()
        filter(); compose.onNodeWithText("Recent activity").performClick()
        toggleArchived(); waitText("Synthetic archived conversation")
        compose.onNodeWithTag("home-search").performClick()
        compose.onNodeWithText("Search agents").performTextInput("needle")
        select("plans"); compose.runOnIdle { assertEquals("", agent.search) }
        select("agent"); compose.runOnIdle {
            assertTrue(agent.archivedOnly); assertEquals(ConversationScope.Team, agent.scope)
            assertEquals(ConversationSort.Activity, agent.sort)
            agent.select(b)
        }
        compose.waitUntil(8_000) { requests.any { it.url.encodedPath == "/agent/conversations" && it.url.queryParameter("teamId") == b.id && it.url.queryParameter("archived") == "only" } }
        noWrites()
    }
    @Test fun selectedPageSurvivesSavedStateAndOutsideDismisses() {
        val restoration = StateRestorationTester(compose)
        render(restoration = restoration); select("plans")
        restoration.emulateSavedInstanceStateRestore(); menu()
        compose.onNodeWithTag("home-page-plans").assertIsSelected()
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val bounds = compose.onAllNodes(isRoot()).onFirst().fetchSemanticsNode().boundsInRoot
        val now = android.os.SystemClock.uptimeMillis()
        for (action in listOf(android.view.MotionEvent.ACTION_DOWN, android.view.MotionEvent.ACTION_UP)) {
            val event = android.view.MotionEvent.obtain(now, now, action, bounds.right - 10f, bounds.bottom - 50f, 0)
            automation.injectInputEvent(event, true); event.recycle()
        }
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("home-page-menu").fetchSemanticsNodes().isEmpty() }
        noWrites()
    }
    @Test fun compactRtlLargeFontAllEntriesAndCheckboxRemainReachable() {
        render(compact = true); menu(); shot("rtl-large-menu")
        for (route in listOf("agent", "plans", "runtimes", "connectors"))
            compose.onNodeWithTag("home-page-$route").performScrollTo().assertIsDisplayed()
        Espresso.pressBack(); filter()
        compose.onNodeWithTag("filter-archived").performScrollTo().assertIsOff()
        shot("rtl-large-filter")
        compose.onNodeWithTag("filter-archived").performClick()
        waitText("Synthetic archived conversation"); noWrites()
    }
    @Test fun deniedHistoryDoesNotBlockNavigationOrAlterWorkspace() {
        historyFailure = true; render()
        select("plans"); select("agent")
        compose.runOnIdle { assertNotNull(agent.phaseError); assertEquals(a.id, agent.selectedTeam?.id) }
        menu(); compose.onNodeWithTag("home-page-connectors").performClick(); noWrites()
    }
    @Test fun keyboardEnterOpensMenuAndBackRestoresAnchor() {
        render(keyboard = true); waitText("Synthetic active conversation")
        compose.onRoot().performKeyInput { pressKey(Key.Tab) }
        compose.onNodeWithTag("home-page-switcher").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.RequestFocus) { it() }
        compose.onNodeWithTag("home-page-switcher").assertIsFocused()
        compose.onNodeWithTag("home-page-switcher").performKeyInput { pressKey(Key.Enter) }
        compose.waitUntil(5_000) { compose.onAllNodesWithTag("home-page-agent").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("home-page-agent").assertIsSelected()
        Espresso.pressBack(); compose.waitForIdle()
        compose.onNodeWithTag("home-page-switcher").assertIsFocused()
        compose.onNodeWithTag("home-page-menu").assertDoesNotExist(); noWrites()
    }

    @Test fun restoreRequiresConfirmationAndStaysInArchivedAfterSuccess() {
        render(); waitText("Synthetic active conversation"); toggleArchived()
        waitText("Synthetic archived conversation")
        compose.onNodeWithText("Synthetic archived conversation").performTouchInput { longClick() }
        compose.onNodeWithText("Restore").performClick(); waitText("Restore agent?")
        compose.onNodeWithText("Cancel").performClick(); assertFalse(restored); noWrites()
        compose.onNodeWithText("Synthetic archived conversation").performTouchInput { longClick() }
        compose.onNodeWithText("Restore").performClick(); waitText("Restore agent?")
        compose.onNodeWithText("Restore").performClick()
        compose.waitUntil(8_000) { restored && agent.conversations.isEmpty() && agent.rowActionSessionId == null }
        filter(); compose.onNodeWithTag("filter-archived").assertIsOn()
        assertEquals(1, requests.count { it.method == "PATCH" })
        assertTrue(requests.none { it.method !in setOf("GET", "PATCH") })
    }

    @Test fun restoreFailureKeepsArchivedAndOffersExplicitRetry() {
        restoreFailure = true; render(); waitText("Synthetic active conversation"); toggleArchived()
        waitText("Synthetic archived conversation")
        compose.onNodeWithText("Synthetic archived conversation").performTouchInput { longClick() }
        compose.onNodeWithText("Restore").performClick(); waitText("Restore agent?")
        compose.onNodeWithText("Restore").performClick()
        waitText("Action failed. Refresh the list and try again.")
        assertFalse(restored); assertTrue(agent.archivedOnly)
        restoreFailure = false; compose.onNodeWithText("Restore").performClick()
        compose.waitUntil(8_000) { restored && agent.conversations.isEmpty() && agent.rowActionSessionId == null }
        assertTrue(agent.archivedOnly); assertEquals(2, requests.count { it.method == "PATCH" })
    }

}
