package ai.nuphos.android

import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.material3.Text
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import android.view.KeyEvent
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.*
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.chat.ConversationScreen
import ai.nuphos.android.ui.theme.NuphosTheme
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.*
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

/** Device UI tests with synthetic transcripts and blocked HTTP. No backend writes occur. */
@RunWith(AndroidJUnit4::class)
class FixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private val requests = CopyOnWriteArrayList<String>()
    private var status = 200
    private var detail = AgentConversationDetail(title = "Synthetic acceptance fixture")
    private lateinit var store: AgentStore
    private lateinit var auth: AuthSession
    private var savedAccess: Any? = null
    @Suppress("UNCHECKED_CAST") private fun accessState() = AiAccess::class.java.getDeclaredField("state").also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>
    private var returned = false
    private var externalLink: String? = null

    @Before fun blockNetwork() {
        val mock = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            requests += request.method + " " + request.url.encodedPath
            val isDetail = request.url.encodedPath.endsWith("/fixture")
            val body = if (isDetail && status == 200) Http.json.encodeToString(AgentConversationDetail.serializer(), detail)
                else if (isDetail) "{\"error\":{\"message\":\"Fixture conversation unavailable\"}}" else "{}"
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(if (isDetail) status else 200)
                .message("fixture").body(body.toResponseBody(Http.jsonMedia)).build()
        }.build()
        for (name in listOf("client", "chatClient")) {
            val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
            originals[name] = field.get(null) as OkHttpClient
            field.set(null, mock)
        }
        compose.runOnIdle {
            savedAccess = accessState().value
            AiAccess.activate("synthetic-no-credentials")
            AiAccess.grant("synthetic-no-credentials")
            val app = compose.activity.application as NuphosApplication
            auth = AuthSession(app, app.tokenStore)
            AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, "synthetic-no-credentials")
            @Suppress("UNCHECKED_CAST")
            val state = AuthSession::class.java.getDeclaredField("state\$delegate").also { it.isAccessible = true }.get(auth) as MutableState<AuthSession.State>
            state.value = AuthSession.State.SignedIn(NuphosUser("acceptance-fixture", "acceptance@example.invalid", "Acceptance fixture"))
        }
        store = AgentStore("synthetic-no-credentials", compose.activity)
        @Suppress("UNCHECKED_CAST")
        val selected = AgentStore::class.java.getDeclaredField("selectedTeam\$delegate").also { it.isAccessible = true }.get(store) as MutableState<Team?>
        selected.value = Team("synthetic-team", "Acceptance fixture")
    }
    @After fun restoreNetwork() {
        compose.runOnIdle { compose.activity.setContent { }; store.disposeForConsent(); accessState().value = savedAccess }
        for ((name, client) in originals) Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client)
    }
    private fun render(parts: List<ChatPart>, readOnly: Boolean = false) {
        detail = detail.copy(messages = listOf(ChatMessage(id = "fixture-message", parts = parts)), readOnly = readOnly)
        compose.runOnIdle {
            compose.activity.setContent {
                NuphosTheme {
                    CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth, LocalUriHandler provides object : UriHandler {
                        override fun openUri(uri: String) { externalLink = uri }
                    }) {
                        val nav = rememberNavController()
                        NavHost(nav, startDestination = "conversation") {
                            composable("conversation") { ConversationScreen("fixture", false, { returned = true }, nav) }
                            composable("plan/{id}") { Text("Fixture plan destination") }
                        }
                    }
                }
            }
        }
        waitFor(hasContentDescription("Back"))
        compose.waitUntil(20_000) { store.session("fixture", "").loaded }
    }
    private fun tool() = ChatPart.Tool("fixture-tool", "terminal", false, ChatPart.Tool.State.OutputAvailable,
        input = JsonValue.obj("command" to JsonValue.Str("printf FIXTURE_TOOL_INPUT")),
        output = JsonValue.Str("FIXTURE_TOOL_OUTPUT"), title = "Fixture terminal")

    @Test fun readOnlyComposerPreventsSubmission() {
        render(listOf(ChatPart.Text(text = "Read-only fixture")), readOnly = true)
        compose.onNodeWithContentDescription("Ask Nuphos anything").performTextInput("Unsent read-only fixture")
        compose.onNodeWithContentDescription("Send").assertIsNotEnabled()
    }
    @Test fun readOnlySessionRejectsDirectMutations() {
        render(listOf(tool()), readOnly = true)
        val session = store.session("fixture", "")
        val before = requests.toList()
        compose.runOnIdle {
            Assert.assertFalse(session.send("Must stay unsent"))
            session.updatePermissionMode(ai.nuphos.android.model.PermissionMode.Bypass)
            session.decide("fixture-tool", ai.nuphos.android.session.ChatSession.ApprovalDecision.Once)
            session.stop()
        }
        kotlinx.coroutines.runBlocking {
            Assert.assertFalse(session.confirmProposedRule("fixture-rule"))
            Assert.assertFalse(session.dismissProposedRule("fixture-rule"))
        }
        Assert.assertEquals(before, requests.toList())
    }
    @Test fun loadErrorDisablesSendAndPreservesTypedDraft() {
        status = 404
        render(emptyList())
        compose.onNodeWithContentDescription("Ask Nuphos anything").performTextInput("Keep failed-load draft")
        compose.onNodeWithContentDescription("Send").assertIsNotEnabled()
        compose.onNodeWithText("Keep failed-load draft").assertExists()
        Assert.assertFalse(store.session("fixture", "").send("No request"))
    }
    @Test fun metadataRevocationAppliesWithUnchangedMessageCount() {
        detail = detail.copy(isOwner = true)
        render(listOf(ChatPart.Text(text = "Same history")))
        val session = store.session("fixture", "")
        Assert.assertTrue(session.canSubmit)
        detail = detail.copy(readOnly = true, isOwner = false)
        kotlinx.coroutines.runBlocking { session.reloadFromServer() }
        compose.waitForIdle()
        Assert.assertFalse(session.canSubmit)
        Assert.assertFalse(session.canManage)
        compose.onNodeWithContentDescription("Ask Nuphos anything").performTextInput("Keep revoked draft")
        compose.onNodeWithContentDescription("Send").assertIsNotEnabled()
    }
    @Test fun writableTeammateHasSendWithoutOwnerActions() {
        detail = detail.copy(isOwner = false, canCancelRun = false, canRespondToRun = false)
        render(listOf(ChatPart.Text(text = "Team fixture")))
        val session = store.session("fixture", "")
        Assert.assertTrue(session.canSubmit)
        Assert.assertFalse(session.canManage)
        Assert.assertFalse(session.canCancel)
        compose.onNodeWithContentDescription("Chat actions").performClick()
        compose.onNodeWithText("Share").assertExists()
        compose.onNodeWithText("Rename").assertDoesNotExist()
        compose.onNodeWithText("Archive").assertDoesNotExist()
    }
    @Test fun completedToolShowsDetails() {
        render(listOf(tool()))
        compose.onNodeWithText("Fixture terminal").performScrollTo().performClick()
        compose.onNodeWithText("FIXTURE_TOOL_OUTPUT", substring = true).assertIsDisplayed()
        compose.onNodeWithText("FIXTURE_TOOL_INPUT", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Done").performClick()
        compose.onNodeWithText("FIXTURE_TOOL_OUTPUT", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Fixture terminal").performClick()
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        compose.onNodeWithText("FIXTURE_TOOL_OUTPUT", substring = true).assertDoesNotExist()
        Assert.assertFalse(returned)
    }
    @Test fun workGroupExpandsAndCollapsesChildren() {
        render(listOf(ChatPart.Reasoning(text = "Fixture reasoning"), tool(), ChatPart.Text(text = "Fixture final")))
        compose.onNodeWithText("Worked through 2 steps").performScrollTo().performClick()
        compose.onNodeWithText("Fixture terminal").assertIsDisplayed()
        compose.onNodeWithText("Fixture terminal").performClick()
        compose.onNodeWithText("FIXTURE_TOOL_OUTPUT", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Done").performClick()
        compose.onNodeWithText("Worked through 2 steps").performClick()
        compose.onNodeWithText("Fixture terminal").assertDoesNotExist()
    }
    @Test fun workGroupsExpandIndependently() {
        render(listOf(ChatPart.Reasoning(text = "First reasoning"), tool(), ChatPart.Text(text = "First final"),
            ChatPart.Reasoning(text = "Second reasoning"), tool().copy(toolCallId = "second-tool", title = "Second terminal"),
            tool().copy(toolCallId = "third-tool", title = "Third terminal"), ChatPart.Text(text = "Second final")))
        compose.onNodeWithText("Worked through 2 steps").performScrollTo().performClick()
        compose.onNodeWithText("Fixture terminal").assertExists()
        compose.onNodeWithText("Second terminal").assertDoesNotExist()
        compose.onNodeWithText("Worked through 3 steps").performScrollTo().performClick()
        compose.onNodeWithText("Second terminal").assertExists()
        compose.onNodeWithText("Worked through 2 steps").performScrollTo().performClick()
        compose.onNodeWithText("Fixture terminal").assertDoesNotExist()
        compose.onNodeWithText("Second terminal").assertExists()
    }
    @Test fun toolFailureAndMissingValuesStayReadable() {
        render(listOf(tool().copy(input = null, output = null, state = ChatPart.Tool.State.OutputError, errorText = "FIXTURE_FAILURE")))
        compose.onNodeWithText("Fixture terminal").performScrollTo().performClick()
        compose.onNodeWithText("Failed").assertIsDisplayed()
        compose.onNodeWithText("No input available").assertIsDisplayed()
        compose.onNodeWithText("No output available").assertIsDisplayed()
        compose.onNodeWithText("FIXTURE_FAILURE").assertIsDisplayed()
    }
    @Test fun deniedToolDoesNotClaimCompletion() {
        render(listOf(tool().copy(output = null, state = ChatPart.Tool.State.OutputDenied)))
        compose.onNodeWithText("Fixture terminal").performScrollTo().performClick()
        compose.onNodeWithText("Denied").assertIsDisplayed()
        compose.onNodeWithText("Execution was denied.").assertIsDisplayed()
    }
    @Test fun pendingToolShowsWaitingOutput() {
        render(listOf(tool().copy(output = null, state = ChatPart.Tool.State.InputAvailable)))
        compose.onNodeWithText("Fixture terminal").performScrollTo().performClick()
        compose.onNodeWithText("Pending").assertIsDisplayed()
        compose.onNodeWithText("Waiting for output").assertIsDisplayed()
    }
    @Test fun longToolDetailsCanScrollAndClose() {
        render(listOf(tool().copy(input = JsonValue.Str((1..80).joinToString("\n") { "Input line $it" }),
            output = JsonValue.Str("FIXTURE_LONG_OUTPUT_END"))))
        compose.onNodeWithText("Fixture terminal").performScrollTo().performClick()
        compose.onNodeWithText("FIXTURE_LONG_OUTPUT_END").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Done").assertIsDisplayed().performClick()
        compose.onNodeWithText("Fixture terminal").assertIsDisplayed()
    }
    @Test fun reasoningExpandsAndCollapses() {
        render(listOf(ChatPart.Reasoning(text = "Fixture reasoning"), ChatPart.Text(text = "Fixture final")))
        compose.onNodeWithText("Fixture reasoning").assertDoesNotExist()
        compose.onNodeWithText("Thought").performScrollTo().performClick()
        compose.onNodeWithText("Fixture reasoning").assertIsDisplayed()
        compose.onNodeWithText("Thought").performClick()
        compose.onNodeWithText("Fixture reasoning").assertDoesNotExist()
    }
    @Test fun deniedAndDeletedConversationStillOfferBack() {
        status = 403
        render(emptyList())
        val loadError = store.session("fixture", "").loadError
        Assert.assertNotNull(loadError)
        waitFor(hasText(loadError!!))
        compose.onNodeWithText(loadError).assertIsDisplayed()
        compose.onNodeWithContentDescription("Back").performClick()
        Assert.assertTrue(returned)
    }
    @Test fun alwaysAllowCancelDoesNotSaveRule() {
        detail = detail.copy(isOwner = true)
        val approval = tool().copy(state = ChatPart.Tool.State.ApprovalRequested, approval = ChatPart.Tool.Approval("fixture-approval"))
        render(listOf(approval))
        compose.onNodeWithText("Always allow…").performScrollTo().performClick()
        compose.onNodeWithText("Always allow").assertIsDisplayed()
        compose.onNodeWithText("Cancel").performClick()
        compose.onNodeWithText("Always allow").assertDoesNotExist()
        Assert.assertTrue(requests.none { it.startsWith("POST ") })
    }
    @Test fun markdownFormatsCodeAndTableText() {
        render(listOf(ChatPart.Text(text = "**Fixture bold**\n\n- Fixture list\n\n```text\nFIXTURE_CODE\n```\n\n| Name | Value |\n| --- | --- |\n| Fixture cell | 42 |")))
        for (text in listOf("Fixture bold", "Fixture list", "FIXTURE_CODE", "Fixture cell")) {
            waitFor(hasText(text, substring = true))
            compose.onNodeWithText(text, substring = true).assertIsDisplayed()
        }
    }
    private fun waitFor(matcher: SemanticsMatcher) { compose.waitUntil(30_000) { runCatching { compose.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }.getOrDefault(false) } }
}
