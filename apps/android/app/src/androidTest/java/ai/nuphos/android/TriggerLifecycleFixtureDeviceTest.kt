package ai.nuphos.android

import android.content.Context
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.ChatPart
import ai.nuphos.android.session.AuthSession
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

/**
 * No trigger page is wired any more, and nothing in the app opens the compatibility route, so
 * these tests open what that route shows directly. Every shared HTTP call ends in this interceptor.
 */
@RunWith(AndroidJUnit4::class)
class TriggerLifecycleFixtureDeviceTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val team = "cccccccccccccccccccccccc"
    private val otherTeam = "dddddddddddddddddddddddd"
    private val run = "lifecycle-fixture-run"
    private val answer = "Saved lifecycle fixture answer"
    private data class Read(val method: String, val path: String)
    private val requests = CopyOnWriteArrayList<Read>()
    private val unexpected = CopyOnWriteArrayList<Read>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    @Volatile private var teams = "valid"
    private var backs = 0
    private lateinit var app: NuphosApplication
    private lateinit var originalState: AuthSession.State
    private var originalMemoryToken: String? = null
    private var savedToken: String? = null
    private var preferences: Map<String, *> = emptyMap<String, Any>()

    private val network = object : ExternalResource() {
        override fun before() {
            app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
            savedToken = app.tokenStore.read()
            preferences = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).all.toMap()
            originalState = app.authSession.state
            originalMemoryToken = app.authSession.token
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                val request = chain.request()
                val path = request.url.encodedPath
                val recorded = Read(request.method, path + (request.url.encodedQuery?.let { "?$it" } ?: ""))
                requests += recorded
                var code = 200
                val body = when {
                    request.method != "GET" -> { unexpected += recorded; code = 599; "{}" }
                    path == "/auth/ai-consent" -> """{"version":"2026-09-28","accepted":true}"""
                    path == "/auth/me" -> """{"id":"lifecycle-fixture-user","name":"Fixture user","avatarURL":""}"""
                    path == "/teams" -> when (teams) {
                        "denied" -> { code = 403; "{}" }
                        "other" -> """{"teams":[{"id":"$otherTeam","name":"Other team"}]}"""
                        else -> """{"teams":[{"id":"$team","name":"Fixture team"},{"id":"$otherTeam","name":"Other team"}]}"""
                    }
                    path == "/agent/conversations" -> """{"conversations":[]}"""
                    path == "/agent/conversations/$run/resources" -> """{"resources":[]}"""
                    path == "/agent/conversations/$run" -> {
                        if (request.url.queryParameter("teamId") != team) unexpected += recorded
                        Http.json.encodeToString(AgentConversationDetail.serializer(), detail())
                    }
                    path == "/agent/plans" -> """{"plans":[]}"""
                    path == "/agent/devices" -> """{"devices":[]}"""
                    path.endsWith("/agent-runtimes/quota") -> """{"quotas":{}}"""
                    path.endsWith("/members") -> """{"members":[]}"""
                    path == "/agent/plan-approval-policy" -> """{"minimumOtherApprovals":0}"""
                    path == "/agent/credential-options" -> """{"options":[]}"""
                    path.endsWith("/favorites") -> """{"revision":0,"favorites":[]}"""
                    path.endsWith("/connectors") -> """{"connectors":[]}"""
                    else -> { unexpected += recorded; code = 599; "{}" }
                }
                Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code)
                    .message("local fixture").body(body.toResponseBody(Http.jsonMedia)).build()
            }.build()
            for (name in listOf("client", "chatClient")) {
                val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
                originals[name] = field.get(null) as OkHttpClient
                field.set(null, client)
            }
            app.tokenStore.write("lifecycle-fixture-token")
            InstrumentationRegistry.getInstrumentation().runOnMainSync { setAuthState(AuthSession.State.Restoring) }
        }

        override fun after() {
            // The inner Activity rule has already closed the Activity.
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                setAuthState(originalState)
                AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }
                    .set(app.authSession, originalMemoryToken)
            }
            if (savedToken == null) app.tokenStore.clear() else app.tokenStore.write(requireNotNull(savedToken))
            originals.forEach { (name, client) ->
                Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client)
            }
            assertTrue("Installed token changed (values withheld)", savedToken == app.tokenStore.read())
            // Loading the fixture's teams and chats makes the app remember both.
            app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).edit().apply {
                val previousTeam = preferences["nuphos.workspace.lastTeamId"] as String?
                if (previousTeam == null) remove("nuphos.workspace.lastTeamId") else putString("nuphos.workspace.lastTeamId", previousTeam)
                val previousChats = preferences["nuphos.home.hasChats"] as Boolean?
                if (previousChats == null) remove("nuphos.home.hasChats") else putBoolean("nuphos.home.hasChats", previousChats)
            }.commit()
            val installed = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).all
            val changedKeys = (preferences.keys + installed.keys).filter { preferences[it] != installed[it] }
            assertTrue("Installed preferences changed (values withheld): $changedKeys", changedKeys.isEmpty())
            assertTrue("Unexpected local requests: $unexpected", unexpected.isEmpty())
            assertTrue("Browsing made a mutation: $requests", requests.all { it.method == "GET" })
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(network).around(compose)

    @Suppress("UNCHECKED_CAST")
    private fun setAuthState(value: AuthSession.State) {
        val field = AuthSession::class.java.getDeclaredField("state\$delegate").also { it.isAccessible = true }
        (field.get(app.authSession) as MutableState<AuthSession.State>).value = value
    }

    private fun detail() = AgentConversationDetail(
        title = "Lifecycle fixture run", readOnly = false, isOwner = true,
        canCancelRun = true, canRespondToRun = true,
        activeRun = AgentConversationDetail.ActiveRun("fixture-active-run"),
        runtimeState = JsonValue.parse("""{"schemaVersion":2,"epoch":"fixture","revision":1,"state":"awaiting-input","actions":{"send":true,"cancel":true,"reply":true,"steer":true}}"""),
        messages = listOf(ChatMessage(id = "fixture-answer", parts = listOf(ChatPart.Text(text = answer)))),
    )

    private fun awaitText(text: String) {
        compose.waitUntil(8_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    }

    /** Opens the read-only run for [team], the way the compatibility route does. */
    private fun openRun(): ai.nuphos.android.session.AgentStore {
        compose.waitUntil(8_000) { app.authSession.aiAllowed }
        val token = requireNotNull(app.authSession.token)
        lateinit var agent: ai.nuphos.android.session.AgentStore
        compose.runOnIdle { agent = ai.nuphos.android.session.AgentStore(token, app) }
        runBlocking(Dispatchers.Main) { agent.loadTeams() }
        compose.runOnIdle {
            compose.activity.setContent {
                ai.nuphos.android.ui.theme.NuphosTheme {
                    CompositionLocalProvider(
                        ai.nuphos.android.ui.LocalAuthSession provides app.authSession,
                        ai.nuphos.android.ui.LocalAgentStore provides agent,
                    ) {
                        val nav = rememberNavController()
                        NavHost(nav, startDestination = "run") {
                            composable("run") {
                                ai.nuphos.android.ui.chat.ConversationScreen(
                                    sessionId = run, fresh = false, onBack = { backs++ }, nav = nav,
                                    browsingOnly = true, browsingTeamId = team,
                                )
                            }
                        }
                    }
                }
            }
        }
        return agent
    }

    private fun assertClosedUnread() {
        compose.waitUntil(8_000) { backs > 0 }
        compose.onNodeWithText(answer).assertDoesNotExist()
    }

    private fun assertReadOnly() {
        compose.onNodeWithText(answer).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Read-only run").assertIsDisplayed()
        compose.onAllNodes(hasSetTextAction()).assertCountEquals(0)
        listOf("Send", "Stop", "Attach", "Ask Nuphos anything", "Queue message", "Agent actions").forEach {
            compose.onNodeWithContentDescription(it).assertDoesNotExist()
        }
        listOf("Approve once", "For this agent", "Always allow…", "Deny", "Cancel run", "Approve plan", "Reject plan").forEach {
            compose.onNodeWithText(it).assertDoesNotExist()
        }
    }

    private fun detailReads() = requests.count { it.path.startsWith("/agent/conversations/$run?") }

    @Test fun aRunShowsItsTranscriptWithoutActionsAndBackLeaves() {
        openRun()
        awaitText(answer)
        assertReadOnly()
        assertTrue("The run did not read its transcript", detailReads() > 0)
        compose.onNodeWithContentDescription("Back").performClick()
        compose.waitUntil(8_000) { backs == 1 }
    }

    @Test fun aRunFromATeamTheAccountCannotSeeIsNotRead() {
        teams = "other"
        openRun()
        assertClosedUnread()
        assertEquals("Another team's run read its transcript", 0, detailReads())
    }

    @Test fun aRunIsNotReadWhenTeamsAreDenied() {
        teams = "denied"
        openRun()
        assertClosedUnread()
        assertEquals("A denied team read the transcript", 0, detailReads())
    }

    @Test fun switchingTeamClosesAnOpenRun() {
        val agent = openRun()
        awaitText(answer)
        compose.runOnIdle { agent.select(agent.teams.single { it.id == otherTeam }) }
        compose.waitUntil(8_000) { backs > 0 }
    }
}
