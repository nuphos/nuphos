package ai.nuphos.android

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.nuphos.android.data.*
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.agent.RuntimeSetupSheet
import ai.nuphos.android.ui.agent.AgentSelectionButton
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList

/** Compose test Activity, synthetic interceptor and injected browser. No socket or provider grant. */
@RunWith(AndroidJUnit4::class)
class RuntimeSetupFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val id = "saved-runtime"
    private val uuid = "00000000-0000-4000-8000-000000000001"
    private val requests = CopyOnWriteArrayList<Request>()
    private val browsers = CopyOnWriteArrayList<String>()
    private var catalog = "[]"
    private var status = "awaiting_authorization"
    private var provider = "codex"
    private var forbidden = false
    private var lostReceipt = false
    private var noLogin = false
    private var codeSubmitted = false
    private var expiry = "2030-01-01T00:00:00Z"
    private var current = true
    private var administrator = true
    private var expired = 0
    private lateinit var store: RuntimeSetupStore
    private val owner = RuntimeSelections()
    private val selection = owner.bind("synthetic-account", "507f1f77bcf86cd799439011")
    private fun runtime(runtimeId: String = id, active: Boolean = true, label: String = "Fixture Agent", kind: String = "managed") = """{"id":"$runtimeId","provider":"$provider","label":"$label","status":"${if (active) "active" else "disabled"}","kind":"$kind"}"""
    private fun login() = """{"attemptId":"$uuid","state":"$status","expiresAt":"$expiry"${if (status == "awaiting_authorization") if (provider == "codex") ",\"verificationUri\":\"https://example.test/device\",\"userCode\":\"SYNTHETIC-CODE\"" else ",\"authorizationUrl\":\"https://example.test/claude\",\"codeSubmitted\":$codeSubmitted" else ""}}"""
    private val api = AgentRuntimeApi("synthetic-no-credentials", "507f1f77bcf86cd799439011", OkHttpClient.Builder().addInterceptor { chain ->
        val request = chain.request(); requests += request
        val path = request.url.encodedPath
        var code = 200
        val body = when {
            request.method == "GET" && path.endsWith("/agent-runtimes") -> """{"runtimes":$catalog}"""
            request.method == "POST" && path.endsWith("/agent-runtimes") -> {
                if (forbidden) { code = 403; """{"error":{"code":"forbidden"}}""" } else {
                    code = 201; catalog = "[${runtime()}]"
                    if (lostReceipt) throw IOException("Synthetic lost creation receipt")
                    runtime()
                }
            }
            request.method == "POST" && path.endsWith("/login/code") -> {
                codeSubmitted = true; login()
            }
            request.method == "POST" && path.endsWith("/login") -> { code = 202; if (lostReceipt) throw IOException("Synthetic lost login receipt"); login() }
            request.method == "GET" && path.endsWith("/login") -> if (noLogin) { code = 404; """{"error":{"code":"runtime_login_not_found"}}""" } else login()
            request.method == "DELETE" && path.endsWith("/login") -> { code = 204; status = "cancelled"; "" }
            else -> throw AssertionError("Unexpected synthetic request")
        }
        Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture").body(body.toResponseBody(Http.jsonMedia)).build()
    }.build())
    private fun render() {
        compose.setContent {
            val scope = rememberCoroutineScope()
            val setup = remember { RuntimeSetupStore(api, scope, { current }, { administrator }, selection, { expired++ }) }
            store = setup
            var visible by remember { mutableStateOf(true) }
            NuphosTheme { if (visible) RuntimeSetupSheet(setup, { visible = false }, { browsers += it }) }
        }
        waitText("Choose an Agent")
        compose.waitUntil(5_000) { store.state.catalogLoaded && !store.state.busy }
    }
    private fun waitText(text: String, substring: Boolean = false) {
        compose.waitUntil(5_000) { compose.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty() }
    }
    private fun click(text: String) = compose.onNodeWithText(text).performScrollTo().performClick()
    private fun select(manage: Boolean = true) {
        if (compose.onAllNodesWithText("Choose an Agent").fetchSemanticsNodes().isEmpty()) click("Change Agent")
        compose.onNodeWithContentDescription("Use Fixture Agent").performScrollTo().performClick()
        compose.waitUntil(5_000) {
            compose.onAllNodesWithContentDescription("Selected Fixture Agent").fetchSemanticsNodes().isNotEmpty()
        }
        if (manage && administrator) click("Manage Agents")
    }
    private fun posts(suffix: String) = requests.count { it.method == "POST" && it.url.encodedPath.endsWith(suffix) }
    @Test fun pickerGroupsAgentsAndKeepsManagementSeparate() {
        catalog = "[${runtime(runtimeId = "computer", label = "My laptop", kind = "local")},${runtime()}]"
        render()
        compose.onNodeWithText("My computers").assertExists()
        compose.onNodeWithText("Cloud and servers").assertExists()
        compose.onAllNodesWithText("Create Agent").assertCountEquals(0)
        compose.onNodeWithText("Manage Agents").performClick()
        compose.onNodeWithText("Create Agent").assertExists()
        click("Back to Agents")
        compose.onAllNodesWithText("Create Agent").assertCountEquals(0)
        compose.onNodeWithText("My computers").assertExists()
        assertEquals(0, posts("/agent-runtimes"))
        assertEquals(0, posts("/login"))
    }

    @Test fun actualSheetCreatesOnceThenSelectsExactSavedRegistration() {
        render(); click("Manage Agents"); compose.onNodeWithText("Agent label (optional)").performScrollTo().performTextInput(" Fixture Agent ")
        click("Create Agent"); waitText("Agent registered and selected.", true)
        assertEquals(id, selection.selectedId); assertEquals(1, posts("/agent-runtimes"))
        assertEquals("GET", requests.last().method)
        val body = Buffer().also { requests.first { it.method == "POST" }.body!!.writeTo(it) }.readUtf8()
        assertEquals("""{"provider":"codex","label":"Fixture Agent"}""", body)
    }
    @Test fun actualCatalogSelectionAndDisabledRemovalNeverFallback() {
        catalog = "[${runtime()}]"; render(); select(manage = false)
        catalog = "[${runtime(active = false)}]"; click("Refresh Agents")
        waitText("The selected Agent is unavailable.", true)
        assertTrue(selection.reselectionRequired); assertNull(selection.binding)
        compose.onNodeWithContentDescription("Selected Fixture Agent").assertIsNotEnabled()
        assertEquals(0, posts("/login"))
    }
    @Test fun homeSelectionLabelUpdatesAndDoesNotShowUnavailableAgent() {
        selection.saveCatalog(listOf(AgentRuntime("computer", "codex", "My laptop", "active", "local")))
        compose.setContent { NuphosTheme { AgentSelectionButton(selection, true, {}) } }
        compose.onNodeWithText("Choose an Agent").assertIsDisplayed()
        compose.runOnIdle { assertTrue(selection.select("computer")) }
        compose.onNodeWithText("My laptop").assertIsDisplayed()
        compose.onNodeWithText("Codex · Change Agent").assertIsDisplayed()
        compose.runOnIdle { selection.saveCatalog(emptyList()) }
        compose.onNodeWithText("Choose an available Agent").assertIsDisplayed()
        compose.onNodeWithText("My laptop").assertDoesNotExist()
    }

    @Test fun localAgentCanBeSelectedByTouchWithoutProviderWrites() {
        catalog = "[${runtime(runtimeId = "computer", label = "My laptop", kind = "local")},${runtime()}]"
        render()
        val card = compose.onNodeWithContentDescription("Use My laptop")
        card.performScrollTo().assertIsDisplayed().assertIsNotSelected()
        card.performTouchInput { click() }
        compose.waitUntil(5_000) { selection.selectedId == "computer" }
        compose.onNodeWithContentDescription("Selected My laptop").assertIsSelected()
        assertEquals("computer", selection.binding?.runtimeId)
        assertTrue(requests.none { it.method != "GET" })
    }

    @Test fun longAgentNameStaysInsideSelectableCard() {
        val name = "Long Agent name for a shared development workspace ".repeat(4)
        catalog = "[${runtime(label = name)}]"
        render()
        val card = compose.onNodeWithContentDescription("Use $name")
        card.performScrollTo().assertIsDisplayed()
        val cardBounds = card.fetchSemanticsNode().boundsInRoot
        val nameBounds = compose.onNodeWithText(name, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertTrue("Name must stay inside the card", nameBounds.left >= cardBounds.left && nameBounds.right <= cardBounds.right)
        assertTrue("Name must leave room for the selection indicator", nameBounds.right < cardBounds.right)
        card.performClick()
        compose.waitUntil(5_000) { selection.selectedId == id }
    }

    @Test fun editorCannotCreateOrSignInAndForbiddenKeepsAccount() {
        administrator = false; catalog = "[${runtime()}]"; render(); select()
        compose.onAllNodesWithText("Create Agent").assertCountEquals(0)
        compose.onAllNodesWithText("Start provider sign-in").assertCountEquals(0)
        assertEquals(0, expired)
    }
    @Test fun forbiddenCreateShowsDenialWithoutExpiry() {
        forbidden = true; render(); click("Manage Agents"); click("Create Agent")
        waitText("Administrator permission is required.", true); assertEquals(0, expired); assertNull(selection.selected)
    }
    @Test fun codexDeviceBrowserIsInjectedAndCancelUsesExactAttempt() {
        catalog = "[${runtime()}]"; render(); select(); click("Start provider sign-in")
        waitText("Provider code: SYNTHETIC-CODE"); click("Open provider sign-in")
        assertEquals(listOf("https://example.test/device"), browsers)
        click("Cancel sign-in"); waitText("Sign-in: cancelled")
        val request = requests.single { it.method == "DELETE" }
        assertEquals("""{"attemptId":"$uuid"}""", Buffer().also { request.body!!.writeTo(it) }.readUtf8())
        assertEquals(1, posts("/login"))
    }
    @Test fun claudeCodeStaysEphemeralAndConnectedRequiresCatalogRead() {
        provider = "claude-code"; catalog = "[${runtime()}]"; render(); select(); click("Start provider sign-in")
        waitText("Full code#state"); click("Open provider sign-in"); assertEquals(listOf("https://example.test/claude"), browsers)
        compose.onNodeWithText("Full code#state").performScrollTo().performTextInput("synthetic#state")
        click("Submit sign-in code")
        compose.waitUntil(5_000) { codeSubmitted && !store.state.busy }
        compose.onAllNodesWithText("Full code#state").assertCountEquals(0)
        status = "connected"; click("Refresh sign-in"); waitText("Sign-in: connected")
        assertTrue(requests.last().url.encodedPath.endsWith("/agent-runtimes")); assertEquals(id, selection.binding?.runtimeId)
    }
    @Test fun expiryDismissalAndSourceRevocationStopAttemptWork() {
        expiry = "2020-01-01T00:00:00Z"; catalog = "[${runtime()}]"; render(); select(); click("Start provider sign-in")
        waitText("Sign-in: failed"); compose.onNodeWithText("Cancel sign-in").assertIsNotEnabled()
        click("Close"); compose.runOnIdle { assertNull(store.state.attempt); current = false; store.refreshLogin() }
        assertEquals(1, posts("/login"))
    }
    @Test fun uncertainLogin404CannotBecomeConnectedOrRestart() {
        lostReceipt = true; noLogin = true; catalog = "[${runtime()}]"; render(); select(); click("Start provider sign-in")
        waitText("No actor-bound sign-in was found.", true)
        compose.onNodeWithText("Start provider sign-in").assertIsNotEnabled()
        click("Refresh sign-in"); waitText("No actor-bound sign-in was found.", true)
        assertEquals(1, posts("/login")); assertNull(store.state.attempt)
    }
    @Test fun uncertainCreateRequiresExplicitSavedReview() {
        lostReceipt = true; render(); click("Manage Agents"); click("Create Agent")
        waitText("We could not identify the saved result.", true)
        compose.onNodeWithText("Create Agent").assertIsNotEnabled(); assertNull(selection.selected)
        select(); assertEquals(1, posts("/agent-runtimes"))
        click("I reviewed saved Agents"); compose.onNodeWithText("Create Agent").assertIsEnabled()
    }
    @Test fun newSessionCapturesExactBindingWithoutNativeAdmission() {
        catalog = "[${runtime()}]"; render(); select()
        compose.runOnIdle {
            val session = ChatSession.fresh("synthetic", "507f1f77bcf86cd799439011", selection.binding)
            assertNull(session.agentRuntime); assertFalse(session.isNative)
            val binding = session.outgoingCreationBinding!!
            val request = AgentChatApi.chatRequest("synthetic", AgentChatApi.ChatRequest(session.sessionId, session.teamId,
                emptyList(), streamId = "synthetic-stream", runtimeId = binding.runtimeId, agentRuntime = binding.agentRuntime))
            val body = Buffer().also { request.body!!.writeTo(it) }.readUtf8()
            assertTrue(body.contains("\"runtimeId\":\"$id\"")); assertTrue(body.contains("\"agentRuntime\":\"codex\""))
        }
    }
}
