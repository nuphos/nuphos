package ai.nuphos.android

import android.content.Context
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
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
class WorkspaceSetupFixtureDeviceTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val a = Team("507f1f77bcf86cd799439011", "Fixture Alpha", role = "ADMINISTRATOR", isOwner = true)
    private val b = Team("507f1f77bcf86cd799439012", "Fixture Beta", role = "EDITOR", isOwner = false)
    private val token = "workspace-synthetic-no-credentials"
    private val requests = CopyOnWriteArrayList<Request>()
    private val unexpected = CopyOnWriteArrayList<Request>()
    @Volatile private var memberships = emptyList<Team>()
    @Volatile private var discovered = listOf(b)
    @Volatile private var writeStatus = 201
    @Volatile private var discoveryStatus = 200
    @Volatile private var membershipStatus = 200
    @Volatile private var unknownWrite = false
    @Volatile private var release: CountDownLatch? = null
    private lateinit var app: NuphosApplication
    private lateinit var setup: WorkspaceSetupStore
    private lateinit var agent: AgentStore
    private lateinit var auth: AuthSession
    private var sourceGeneration = 1L
    private var selected: Team? = null
    private var expired = 0
    private var savedAccess: Any? = null
    private lateinit var savedAuth: AuthSession
    private var savedLastTeam: String? = null
    private val originals = mutableMapOf<String, OkHttpClient>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    @Suppress("UNCHECKED_CAST") private fun state(target: Any, name: String, delegated: Boolean = true) =
        target.javaClass.getDeclaredField(name + if (delegated) "\$delegate" else "").also { it.isAccessible = true }.get(target) as MutableState<Any?>
    private val network = object : ExternalResource() {
        override fun before() {
            app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
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
                val create = request.method == "POST" && path == "/teams"
                val join = request.method == "POST" && path == "/teams/discoverable/${b.id}/join"
                val teamRead = request.method == "GET" && path == "/teams"
                val discovery = request.method == "GET" && path == "/teams/discoverable"
                val favorites = request.method == "GET" && path in setOf("/teams/${a.id}/favorites", "/teams/${b.id}/favorites")
                val consent = request.method == "GET" && path == "/auth/ai-consent"
                val connectors = request.method == "GET" && path in setOf("/teams/${a.id}/connectors", "/teams/${b.id}/connectors")
                val history = request.method == "GET" && path == "/agent/conversations" && request.url.queryParameter("teamId") in setOf(a.id, b.id)
                val plans = request.method == "GET" && path == "/agent/plans" && request.url.queryParameter("teamId") in setOf(a.id, b.id)
                val members = request.method == "GET" && path in setOf("/teams/${a.id}/members", "/teams/${b.id}/members")
                val policy = request.method == "GET" && path == "/agent/plan-approval-policy" && request.url.queryParameter("teamId") in setOf(a.id, b.id)
                if (!create && !join && !teamRead && !discovery && !favorites && !history && !consent && !connectors && !plans && !members && !policy) unexpected += request
                var code = 200
                val body = when {
                    create || join -> {
                        release?.await(8, TimeUnit.SECONDS)
                        val target = if (join) b else a
                        if (writeStatus == 201 || writeStatus == 409) memberships = (memberships + target).distinctBy { it.id }
                        if (unknownWrite) throw IOException("Synthetic lost write receipt")
                        code = writeStatus
                        if (code == 201) """{"team":${Http.json.encodeToString(Team.serializer(), target)}}"""
                        else """{"error":{"code":"${if (code == 409) "already_member" else "fixture_denied"}","message":"fixture denial"}}"""
                    }
                    teamRead -> { code = membershipStatus; """{"teams":${Http.json.encodeToString(ListSerializer(Team.serializer()), memberships)}}""" }
                    discovery -> { code = discoveryStatus; """{"teams":${Http.json.encodeToString(ListSerializer(Team.serializer()), discovered)}}""" }
                    consent -> """{"version":"2026-09-28","accepted":true}"""
                    connectors -> "{}"
                    favorites -> """{"entries":[],"revision":0}"""
                    history -> """{"conversations":[],"nextCursor":null}"""
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
            release?.countDown()
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                if (::setup.isInitialized) setup.close()
                if (::agent.isInitialized) agent.disposeForConsent()
                scope.cancel()
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
    private fun renderSheet() {
        compose.runOnIdle {
            val expected = sourceGeneration
            setup = WorkspaceSetupStore(WorkspaceApi(token), scope, { sourceGeneration == expected },
                { _, team -> if (team != null) selected = team; true }, { expired++ })
            compose.activity.setContent {
                var visible by remember { mutableStateOf(true) }
                NuphosTheme { if (visible) WorkspaceSetupSheet(setup) { visible = false } }
            }
        }
        waitText("Workspace name")
        compose.waitUntil(5_000) { !setup.state.busy && (setup.state.discoveryLoaded || setup.state.discoveryError != null) }
    }
    private fun waitText(text: String, substring: Boolean = false) {
        compose.waitUntil(5_000) { compose.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty() }
    }
    private fun posts() = requests.count { it.method == "POST" }
    private fun create() {
        compose.onNodeWithText("Workspace name").performScrollTo().performTextInput(" Fixture Alpha ")
        compose.onNodeWithText("Create workspace").performScrollTo().performClick()
    }
    @Test fun actualSheetCreatesOnceAndSelectsSavedRole() {
        release = CountDownLatch(1); renderSheet(); create()
        compose.onNodeWithText("Create workspace").assertIsNotEnabled()
        compose.waitUntil(5_000) { posts() == 1 }
        assertNull(selected); release!!.countDown()
        waitText("Workspace selected: Fixture Alpha")
        assertEquals(a, selected); assertEquals(1, posts())
        assertTrue(requests.last { it.url.encodedPath == "/teams" }.method == "GET")
    }
    @Test fun actualJoinAndAlreadyMemberBothReadSavedMembership() {
        writeStatus = 409; renderSheet()
        compose.onNodeWithText("Join Fixture Beta").performScrollTo().performClick()
        waitText("Workspace selected: Fixture Beta")
        assertEquals(b, selected); assertEquals(1, posts())
        assertEquals(false, selected!!.isOwner); assertEquals("EDITOR", selected!!.role)
    }
    @Test fun actualJoin201SelectsOnlySavedTarget() {
        renderSheet(); compose.onNodeWithText("Join Fixture Beta").performScrollTo().performClick()
        waitText("Workspace selected: Fixture Beta"); assertEquals(b, selected); assertEquals(1, posts())
    }
    @Test fun unknownCreateReconcilesAndNeedsExplicitSavedReview() {
        unknownWrite = true; renderSheet(); create()
        waitText("We could not identify the saved result", true)
        compose.onNodeWithText("Create workspace").assertIsNotEnabled()
        compose.onNodeWithText("Use Fixture Alpha").performScrollTo().performClick()
        assertEquals(a, selected); assertEquals(1, posts())
        compose.onNodeWithText("Create workspace").assertIsNotEnabled()
    }
    @Test fun forbiddenDoesNotSignOutAndEmptyDiscoveryIsValid() {
        writeStatus = 403; renderSheet()
        compose.onNodeWithText("Join Fixture Beta").performScrollTo().performClick()
        waitText("You are not allowed to join this workspace."); assertEquals(0, expired); assertNull(selected)
        discovered = emptyList()
        compose.onNodeWithText("Refresh workspaces").performScrollTo().performClick()
        waitText("No workspaces are available to join for this account.")
    }
    @Test fun discoveryForbiddenDoesNotInventJoinOrExpire() {
        discovered = emptyList(); discoveryStatus = 403
        compose.runOnIdle {
            setup = WorkspaceSetupStore(WorkspaceApi(token), scope, { true }, { _, _ -> true }, { expired++ })
            compose.activity.setContent { NuphosTheme { WorkspaceSetupSheet(setup) {} } }
        }
        waitText("We could not load workspaces to join", true)
        compose.onAllNodesWithText("Join Fixture Beta").assertCountEquals(0); assertEquals(0, expired)
    }
    @Test fun dismissedWriteAndLateAccountResultNeverSelect() {
        release = CountDownLatch(1); renderSheet(); create()
        compose.waitUntil(5_000) { posts() == 1 }
        compose.onNodeWithText("Close").performScrollTo().performClick()
        compose.runOnIdle { sourceGeneration += 2 }
        release!!.countDown()
        compose.waitUntil(5_000) { memberships.isNotEmpty() }
        compose.runOnIdle { assertNull(selected); assertTrue(setup.state.reviewRequired) }
        assertEquals(1, posts())
    }
    @Test fun expiredSessionUsesOnlyCurrentSourceHandler() {
        writeStatus = 401; renderSheet()
        compose.onNodeWithText("Join Fixture Beta").performScrollTo().performClick()
        compose.waitUntil(5_000) { expired == 1 }
        assertNull(selected); assertEquals(1, posts())
    }
    @Test fun sameAccountWorkspaceGenerationRejectsLateWrite() {
        release = CountDownLatch(1); renderSheet(); create()
        compose.waitUntil(5_000) { posts() == 1 }
        compose.runOnIdle { sourceGeneration += 2 }
        release!!.countDown()
        compose.waitUntil(5_000) { memberships.isNotEmpty() }
        compose.runOnIdle { setup.close(); assertNull(selected) }
        assertEquals(1, posts())
    }
    private fun renderHome(saved: List<Team>) {
        memberships = saved
        compose.runOnIdle {
            AiAccess.activate(token); AiAccess.grant(token)
            agent = AgentStore(token, compose.activity); agent.acceptMemberships(saved, saved.firstOrNull()?.id)
            auth = app.authSession
            AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
            state(auth, "state").value = AuthSession.State.SignedIn(NuphosUser.preview)
            auth.composerDrafts.onIdentity(NuphosUser.preview.id)
            val browsing = BrowsingApi(token)
            val plans = PlansStore(token)
            val connectors = ConnectorsStore(ConnectorApi(token))
            compose.activity.setContent { NuphosTheme {
                CompositionLocalProvider(LocalAgentStore provides agent, LocalAuthSession provides auth,
                    LocalPlansStore provides plans, LocalConnectorsStore provides connectors) {
                    HomeScreen(NuphosUser.preview, rememberNavController(), MonitoringStore(browsing), TriggersStore(browsing),
                        TriggerRunsStore { team, trigger, cursor -> NuphosApi.conversations(token, team, cursor = cursor, scope = ConversationScope.Team, triggerId = trigger) })
                }
            } }
        }
    }
    @Test fun actualHomeEmptyEntryOpensNativeSetup() {
        renderHome(emptyList())
        waitText("Choose or set up a workspace to get started.")
        compose.onNodeWithText("Set up a workspace").performClick()
        waitText("Workspace name"); waitText("Join Fixture Beta")
    }
    @Test fun activityRecreationWithFailedReadKeepsUncertainWriteBlocked() {
        release = CountDownLatch(1); renderHome(emptyList())
        compose.runOnIdle {
            NuphosApplication::class.java.getDeclaredField("authSession").also { it.isAccessible = true }.set(app, auth)
        }
        compose.onNodeWithText("Set up a workspace").performClick()
        waitText("Join Fixture Beta"); create()
        compose.waitUntil(5_000) { posts() == 1 }
        membershipStatus = 500
        compose.activityRule.scenario.recreate()
        release!!.countDown()
        waitText("Choose workspace")
        compose.onNodeWithText("Choose workspace").performClick()
        compose.onNodeWithText("Set up a workspace").performClick()
        waitText("The request may have completed. Closing this sheet does not undo a saved workspace.")
        compose.onNodeWithText("Create workspace").assertIsNotEnabled()
        compose.onNodeWithText("I reviewed saved workspaces").assertIsNotEnabled()
        assertEquals(1, posts())
    }
    @Test fun revokedSourceClosesSheetWithoutRecompositionLoop() {
        renderHome(emptyList())
        compose.onNodeWithText("Set up a workspace").performClick()
        waitText("Workspace name")
        compose.runOnIdle { AiAccess.revoke() }
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Workspace name").fetchSemanticsNodes().isEmpty() }
        compose.waitForIdle()
        assertEquals(0, posts())
    }
    @Test fun invitationRefreshRevealsOnlySavedMembershipInChooser() {
        renderHome(emptyList())
        compose.onNodeWithText("Set up a workspace").performClick()
        waitText("Join Fixture Beta")
        memberships = listOf(b)
        compose.onNodeWithText("Refresh workspaces").performScrollTo().performClick()
        compose.waitUntil(5_000) { agent.teams == listOf(b) }
        compose.onNodeWithText("Close").performScrollTo().performClick()
        compose.onNodeWithText("Choose workspace").performClick()
        compose.onNodeWithText("Fixture Beta").performClick()
        compose.runOnIdle { assertEquals(b, agent.selectedTeam) }
        assertEquals(0, posts())
    }
    @Test fun actualChooserSwitchesMembershipAndPreservesRealDraftStore() {
        renderHome(listOf(a, b)); waitText("Fixture Alpha")
        compose.runOnIdle {
            auth.composerDrafts.bind(NuphosUser.preview.id, a.id, ComposerDrafts.Destination.NewChat)!!.write(" Alpha draft ")
        }
        compose.onNodeWithText("Fixture Alpha").performClick()
        compose.onNodeWithText("Fixture Beta").performClick()
        compose.runOnIdle {
            assertEquals(b, agent.selectedTeam)
            auth.composerDrafts.bind(NuphosUser.preview.id, b.id, ComposerDrafts.Destination.NewChat)!!.write("Beta draft")
        }
        compose.onNodeWithText("Fixture Beta").performClick()
        compose.onNodeWithText("Fixture Alpha").performClick()
        compose.runOnIdle {
            assertEquals(a, agent.selectedTeam)
            assertEquals(" Alpha draft ", auth.composerDrafts.bind(NuphosUser.preview.id, a.id, ComposerDrafts.Destination.NewChat)!!.text)
            assertEquals("Beta draft", auth.composerDrafts.bind(NuphosUser.preview.id, b.id, ComposerDrafts.Destination.NewChat)!!.text)
        }
        compose.onNodeWithText("Fixture Alpha").performClick()
        compose.onNodeWithText("Set up a workspace").performClick()
        waitText("Workspace name")
    }
}
