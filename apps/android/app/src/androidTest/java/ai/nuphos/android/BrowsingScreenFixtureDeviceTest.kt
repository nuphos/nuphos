package ai.nuphos.android

import androidx.activity.compose.setContent
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.*
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.chat.ConversationScreen
import ai.nuphos.android.ui.theme.NuphosTheme
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

/** Real transcript screen with synthetic data and no server connection. */
@RunWith(AndroidJUnit4::class)
class BrowsingScreenFixtureDeviceTest {
    private val compose = createAndroidComposeRule<androidx.activity.ComponentActivity>()
    private val requests = CopyOnWriteArrayList<Request>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private val team = "screen-fixture-team"
    private var native = false
    private lateinit var store: AgentStore
    private lateinit var nav: NavHostController
    private var backs = 0
    private val openedUris = mutableListOf<String>()
    @Suppress("UNCHECKED_CAST") private fun accessState() = AiAccess::class.java.getDeclaredField("state").also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>
    private val network = object : ExternalResource() {
        private var savedAccess: Any? = null
        private lateinit var installedAuth: AuthSession
        private lateinit var savedState: AuthSession.State
        private var savedToken: String? = null
        private var savedPersistedToken: String? = null
        override fun before() {
            val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
            installedAuth = app.authSession
            savedState = installedAuth.state
            savedToken = installedAuth.token
            savedPersistedToken = app.tokenStore.read()
            InstrumentationRegistry.getInstrumentation().runOnMainSync { savedAccess = accessState().value }
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                val request = chain.request()
                requests += request
                val body = if (request.url.encodedPath.endsWith("/screen-fixture"))
                    Http.json.encodeToString(AgentConversationDetail.serializer(), detail()) else "{}"
                Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200)
                    .message("fixture").body(body.toResponseBody(Http.jsonMedia)).build()
            }.build()
            for (name in listOf("client", "chatClient")) {
                val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
                originals[name] = field.get(null) as OkHttpClient
                field.set(null, client)
            }
        }
        override fun after() {
            // Activity teardown disposes the browsing session before transport restoration.
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                accessState().value = savedAccess
                state(installedAuth, "state", savedState)
                AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(installedAuth, savedToken)
            }
            val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
            assertTrue("Transcript fixture changed installed token (values withheld)", savedPersistedToken == app.tokenStore.read())
            originals.forEach { (name, client) ->
                Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client)
            }
        }
    }
    // Install the blocker before MainActivity can start authentication reads.
    @get:Rule val rules: RuleChain = RuleChain.outerRule(network).around(compose)

    @Suppress("UNCHECKED_CAST")
    private fun state(target: Any, name: String, value: Any?) {
        val field = target.javaClass.getDeclaredField(name + "\$delegate").also { it.isAccessible = true }
        (field.get(target) as MutableState<Any?>).value = value
    }

    private fun detail() = AgentConversationDetail(
        runtimeId = "fixture-laptop", runtimeLabel = "Fixture laptop",
        title = "Saved fixture run", readOnly = false, isOwner = true,
        canCancelRun = true, canRespondToRun = true,
        agentRuntime = if (native) "openab" else null,
        activeRun = AgentConversationDetail.ActiveRun("active-fixture"),
        runtimeState = JsonValue.parse("""{"schemaVersion":2,"epoch":"screen-fixture","revision":1,"state":"awaiting-input","actions":{"send":true,"cancel":true,"reply":true,"steer":true}}"""),
        messages = listOf(ChatMessage(id = "saved", parts = listOf(
            ChatPart.Reasoning(text = "Saved fixture reasoning"),
            ChatPart.Tool("completed", "terminal", false, ChatPart.Tool.State.OutputAvailable,
                title = "Saved completed tool", input = JsonValue.Str("fixture input"), output = JsonValue.Str("fixture output")),
            ChatPart.Tool("approval", "terminal", false, ChatPart.Tool.State.ApprovalRequested,
                title = "Saved approval tool", approval = ChatPart.Tool.Approval("fixture-approval")),
            ChatPart.Text(text = "Saved fixture answer"),
            ChatPart.Text(text = "[Open saved plan](https://nuphos.ai/teams/$team/plans/fixture-plan)"),
        ))),
    )

    private fun render(selectedTeam: String = team) {
        compose.runOnIdle {
            AiAccess.activate("synthetic-no-credentials")
            AiAccess.grant("synthetic-no-credentials")
            store = AgentStore("synthetic-no-credentials", compose.activity)
            state(store, "selectedTeam", Team(selectedTeam, "Fixture team"))
            val app = compose.activity.application as NuphosApplication
            // Never call restore/sign-in/sign-out or write the installed token store.
            val auth = AuthSession(app, app.tokenStore)
            AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, "synthetic-no-credentials")
            compose.activity.setContent {
                NuphosTheme {
                    CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth,
                        LocalUriHandler provides object : UriHandler {
                            override fun openUri(uri: String) { openedUris += uri }
                        }) {
                        nav = rememberNavController()
                        NavHost(nav, startDestination = "fixture") {
                            composable("fixture") {
                                ConversationScreen("screen-fixture", false, { backs++ }, nav,
                                    browsingOnly = true, browsingTeamId = team)
                            }
                            composable("plan/{planId}") { Text("Editable plan route reached") }
                        }
                    }
                }
            }
        }
    }

    private fun assertNoActions() {
        listOf("Ask Nuphos anything", "Queue a message", "Queue message", "Send", "Stop", "Attach", "Chat actions").forEach {
            compose.onNodeWithContentDescription(it).assertDoesNotExist()
        }
        listOf("Approve once", "For session", "Always allow…", "Deny", "Cancel run",
            "Check delivery", "Retry steering", "Approve plan", "Reject plan", "Request changes",
            "Rename", "Archive", "Delete").forEach { compose.onNodeWithText(it).assertDoesNotExist() }
        compose.onAllNodes(hasSetTextAction()).assertCountEquals(0)
    }

    @Test fun fullTitleDialogDoesNotEnableActionsOrFetchAgain() {
        render()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Saved fixture answer").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Agent: Fixture laptop").assertIsDisplayed()
        compose.onNodeWithContentDescription("Show full chat title").performClick()
        compose.onNodeWithText("Chat title").assertIsDisplayed()
        compose.onAllNodesWithText("Saved fixture run").onLast().assertIsDisplayed()
        compose.onNodeWithText("Done").performClick()
        compose.onNodeWithText("Chat title").assertDoesNotExist()
        assertNoActions()
        assertEquals(1, requests.count { it.url.encodedPath.endsWith("/screen-fixture") })
    }

    @Test fun legacyRunUsesTheReadOnlyScreen() = exercise(false)
    @Test fun nativeRunUsesTheReadOnlyScreen() = exercise(true)
    private fun exercise(isNative: Boolean) {
        native = isNative
        render()
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Saved fixture answer").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Saved fixture answer").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Read-only run").assertIsDisplayed()
        compose.onNodeWithText("Worked through 2 steps").performScrollTo().performClick()
        compose.onNodeWithText("Saved completed tool").performScrollTo().assertIsDisplayed().performClick()
        compose.onNodeWithText("Input").assertIsDisplayed()
        compose.onNodeWithText("fixture input", substring = true).assertIsDisplayed()
        compose.onNodeWithText("fixture output", substring = true).assertIsDisplayed()
        assertNoActions()
        compose.onNodeWithText("Done").performClick()
        compose.onNodeWithText("Saved approval tool").performScrollTo().assertIsDisplayed()
        assertNoActions()

        val link = compose.onNodeWithText("Open saved plan").performScrollTo()
        val layouts = mutableListOf<TextLayoutResult>()
        link.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        assertTrue("The fixture plan link must have text layout", layouts.isNotEmpty())
        val point = layouts.single().getBoundingBox(1).center
        link.performTouchInput { click(Offset(point.x, point.y)) }
        compose.runOnIdle {
            assertEquals("fixture", nav.currentDestination?.route)
            assertTrue(openedUris.isEmpty())
        }
        compose.onNodeWithText("Editable plan route reached").assertDoesNotExist()
        compose.onNodeWithText("Refresh").performClick()
        compose.waitUntil(5_000) { requests.count { it.url.encodedPath.endsWith("/screen-fixture") } == 2 }
        compose.waitForIdle()
        assertTrue(requests.all { it.method == "GET" })
        assertEquals(2, requests.count { it.url.encodedPath.endsWith("/screen-fixture") })
        assertNoActions()
        compose.onNodeWithContentDescription("Back").performClick()
        compose.runOnIdle { assertEquals(1, backs) }
    }

    @Test fun staleSelectedTeamExitsBeforeAnyTranscriptRead() {
        render(selectedTeam = "different-fixture-team")
        compose.waitUntil(5_000) { backs == 1 }
        compose.onNodeWithText("Refresh").assertDoesNotExist()
        compose.onNodeWithText("Saved fixture run").assertDoesNotExist()
        assertTrue(requests.none { it.url.encodedPath.contains("screen-fixture") })
        assertTrue(requests.all { it.method == "GET" })
    }
}
