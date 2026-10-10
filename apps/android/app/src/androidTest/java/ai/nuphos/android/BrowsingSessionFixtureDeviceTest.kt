package ai.nuphos.android

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.*
import ai.nuphos.android.session.ChatSession
import ai.nuphos.android.session.AiAccess
import androidx.compose.runtime.MutableState
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.*
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

@RunWith(AndroidJUnit4::class)
class BrowsingSessionFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private val requests = CopyOnWriteArrayList<Request>()
    private var native = false
    private var savedAccess: Any? = null
    @Suppress("UNCHECKED_CAST") private fun accessState() = AiAccess::class.java.getDeclaredField("state").also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>
    @Before fun blockNetwork() {
        compose.runOnIdle { savedAccess = accessState().value }
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            requests += request
            val detail = AgentConversationDetail(
                title = "Read-only fixture", readOnly = false, isOwner = true,
                canCancelRun = true, canRespondToRun = true,
                agentRuntime = if (native) "openab" else null,
                activeRun = AgentConversationDetail.ActiveRun("active-fixture"),
                messages = listOf(ChatMessage(id = "user", role = ChatMessage.Role.User,
                    parts = listOf(ChatPart.Text(text = "Existing question"))),
                    ChatMessage(id = "assistant", parts = listOf(ChatPart.Tool(toolCallId = "tool", toolName = "terminal", isDynamic = false,
                        state = ChatPart.Tool.State.ApprovalRequested,
                        input = JsonValue.parse("""{"command":"echo fixture"}"""),
                        approval = ChatPart.Tool.Approval("approval")), ChatPart.Text(text = "Saved answer")))),
                runtimeState = JsonValue.parse("""{"schemaVersion":2,"epoch":"fixture","revision":1,"state":"running","actions":{"send":true,"cancel":true,"reply":true,"steer":true}}"""),
            )
            val text = if (request.url.encodedPath.endsWith("/fixture"))
                Http.json.encodeToString(AgentConversationDetail.serializer(), detail) else "{}"
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200)
                .message("fixture").body(text.toResponseBody(Http.jsonMedia)).build()
        }.build()
        for (name in listOf("client", "chatClient")) {
            val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
            originals[name] = field.get(null) as OkHttpClient
            field.set(null, client)
        }
    }
    @After fun restore() {
        compose.runOnIdle { accessState().value = savedAccess }
        originals.forEach { (name, client) ->
            Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client)
        }
    }
    @Test fun activeLegacyRunRemainsGetOnly() = exercise(false)
    @Test fun activeNativeRunRemainsGetOnly() = exercise(true)
    private fun exercise(isNative: Boolean) {
        native = isNative
        compose.runOnIdle { AiAccess.activate("fixture-no-credentials"); AiAccess.grant("fixture-no-credentials") }
        val session = ChatSession("fixture-no-credentials", "fixture-team", "fixture", browsingOnly = true)
        try {
            session.sendAfterLoad = "Never send this prompt"
            runBlocking { session.load(); session.reloadFromServer(); session.pollWhileIdle() }
            compose.runOnIdle {
                Assert.assertFalse(session.send("Do not send"))
                session.stop()
                session.decide("tool", ChatSession.ApprovalDecision.Always, "Never create this rule")
                session.updatePermissionMode(PermissionMode.Bypass)
                session.requestPlanChanges("Never send changes")
                Assert.assertFalse(session.recoverRuntime())
                Assert.assertFalse(session.retryQueued())
                session.retryUpload()
            }
            runBlocking {
                session.syncTranscriptNow()
                session.rate("assistant", "up")
                Assert.assertFalse(session.confirmProposedRule("rule"))
                Assert.assertFalse(session.dismissProposedRule("rule"))
                Assert.assertTrue(runCatching { session.approvePlan("plan") }.isFailure)
                Assert.assertTrue(runCatching { session.rejectPlan("plan") }.isFailure)
            }
            compose.waitForIdle()
            Assert.assertTrue(session.readOnly)
            Assert.assertFalse(session.isStreaming)
            Assert.assertEquals("Saved answer", session.messages.last().parts.filterIsInstance<ChatPart.Text>().single().text)
            Assert.assertTrue(requests.isNotEmpty())
            Assert.assertTrue(requests.all { it.method == "GET" })
            Assert.assertEquals(2, requests.count { it.url.encodedPath.endsWith("/fixture") })
        } finally {
            session.disposeBrowsing()
        }
    }
}
