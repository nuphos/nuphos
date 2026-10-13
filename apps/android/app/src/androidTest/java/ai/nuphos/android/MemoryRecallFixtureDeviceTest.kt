package ai.nuphos.android

import android.content.Context
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.*
import ai.nuphos.android.model.*
import ai.nuphos.android.session.*
import ai.nuphos.android.ui.*
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

/** Synthetic transcript only. The interceptor never opens a network connection. */
@RunWith(AndroidJUnit4::class)
class MemoryRecallFixtureDeviceTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val requests = CopyOnWriteArrayList<Request>()
    private val unexpected = CopyOnWriteArrayList<Request>()
    private val originals = mutableMapOf<String, OkHttpClient>()
    private val token = "recall-fixture-no-credentials"
    private lateinit var store: AgentStore
    private lateinit var app: NuphosApplication
    private var savedAccess: Any? = null
    private var savedLastTeam: String? = null
    @Volatile private var deny = false
    @Suppress("UNCHECKED_CAST") private fun state(target: Any, name: String, delegated: Boolean = true) =
        target.javaClass.getDeclaredField(name + if (delegated) "\$delegate" else "").also { it.isAccessible = true }.get(target) as MutableState<Any?>
    private val network = object : ExternalResource() {
        override fun before() {
            app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
            savedLastTeam = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).getString("nuphos.workspace.lastTeamId", null)
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                savedAccess = state(AiAccess, "state", false).value
                AiAccess.activate(token)
            }
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                val request = chain.request(); requests += request
                val detailRequest = request.method == "GET" && request.url.encodedPath == "/agent/conversations/saved" &&
                    request.url.queryParameter("teamId") in setOf("A", "B")
                val bypassRequest = request.method == "GET" && request.url.encodedPath == "/agent/auto-mode/bypass" &&
                    request.url.queryParameter("sessionId") == "saved"
                val favoritesRequest = request.method == "GET" && request.url.encodedPath in setOf("/teams/A/favorites", "/teams/B/favorites")
                if (!detailRequest && !bypassRequest && !favoritesRequest) unexpected += request
                val detail = AgentConversationDetail(isOwner = false, agentRuntime = "nuphos", title = "Recall fixture",
                    messages = listOf(ChatMessage(id = "recall-message", parts = listOf(
                        ChatPart.Other(JsonValue.parse("""{"type":"memory-provenance","turnKey":"one","recalledTeamIds":["team-id","team-id","missing","duplicate"],"fetchedPersonalIds":["private-id","duplicate"],"fetchedIds":["team-id","private-id","unknown-id","missing","duplicate"],"labels":{"team-id":"${"Team guide ".repeat(80)}","private-id":"Private secret","unknown-id":"Unknown secret","duplicate":"Duplicate secret"}}""")!!),
                        ChatPart.Other(JsonValue.parse("""{"type":"memory-provenance","turnKey":"two","fetchedIds":["count-only-id"]}""")!!),
                    ))))
                val forbidden = deny || request.url.queryParameter("teamId") != "A"
                val body = when {
                    detailRequest && !forbidden -> Http.json.encodeToString(AgentConversationDetail.serializer(), detail)
                    bypassRequest -> """{"bypass":false}"""
                    favoritesRequest -> """{"entries":[],"revision":0}"""
                    else -> "{}"
                }
                Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                    .code(when { !detailRequest && !bypassRequest && !favoritesRequest -> 500; detailRequest && forbidden -> 403; else -> 200 })
                    .message("fixture").body(body.toResponseBody(Http.jsonMedia)).build()
            }.build()
            for (name in listOf("client", "chatClient")) {
                val field = Http::class.java.getDeclaredField(name).also { it.isAccessible = true }
                originals[name] = field.get(null) as OkHttpClient; field.set(null, client)
            }
        }
        override fun after() {
            InstrumentationRegistry.getInstrumentation().runOnMainSync {
                if (::store.isInitialized) store.disposeForConsent()
                state(AiAccess, "state", false).value = savedAccess
                val editor = app.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE).edit()
                if (savedLastTeam == null) editor.remove("nuphos.workspace.lastTeamId") else editor.putString("nuphos.workspace.lastTeamId", savedLastTeam)
                editor.commit()
            }
            originals.forEach { (name, client) -> Http::class.java.getDeclaredField(name).also { it.isAccessible = true }.set(null, client) }
            assertTrue("Unexpected HTTP paths: ${unexpected.map { it.method + " " + it.url.encodedPath }}", unexpected.isEmpty())
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(network).around(compose)
    private fun render() {
        compose.runOnIdle {
            AiAccess.grant(token)
            store = AgentStore(token, compose.activity)
            state(store, "selectedTeam").value = Team("A", "Fixture A")
            val auth = AuthSession(app, app.tokenStore)
            AuthSession::class.java.getDeclaredField("token").also { it.isAccessible = true }.set(auth, token)
            compose.activity.setContent {
                NuphosTheme { CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth,
                    LocalDensity provides Density(LocalDensity.current.density, 2f)) {
                    ConversationScreen("saved", false, {}, rememberNavController())
                } }
            }
        }
    }
    private fun waitText(text: String) { compose.waitUntil(5_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() } }
    private fun assertPrivateHidden() {
        listOf("Private secret", "Unknown secret", "Duplicate secret", "private-id", "unknown-id", "duplicate", "count-only-id").forEach {
            compose.onAllNodesWithText(it, substring = true, useUnmergedTree = true).assertCountEquals(0)
        }
    }
    @Test fun actualTranscriptExpandsTeamOnlyAndCollapseStaysReachableAtLargeFont() {
        render(); waitText("Show memory details")
        compose.onNodeWithText("Show memory details").performScrollTo().performClick()
        compose.onNodeWithText("Team · Team guide", substring = true).assertExists()
        assertPrivateHidden()
        compose.onNodeWithText("Hide memory details").performScrollTo().performClick()
        compose.onNodeWithText("Team · Team guide", substring = true).assertDoesNotExist()
        assertPrivateHidden()
        assertTrue(unexpected.isEmpty())
        compose.runOnIdle { state(store, "selectedTeam").value = Team("B", "Fixture B") }
        compose.waitUntil(5_000) { requests.any { it.url.encodedPath == "/agent/conversations/saved" && it.url.queryParameter("teamId") == "B" } }
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Show memory details").fetchSemanticsNodes().isEmpty() }
        compose.onAllNodesWithText("Show memory details").assertCountEquals(0)
        assertPrivateHidden()
    }
    @Test fun forbiddenTranscriptDoesNotExposeRecallDetails() {
        deny = true; render()
        compose.waitUntil(5_000) { requests.any { it.url.encodedPath == "/agent/conversations/saved" } }
        compose.waitForIdle()
        compose.onAllNodesWithText("Show memory details").assertCountEquals(0)
        assertPrivateHidden()
        assertTrue(unexpected.isEmpty())
    }
}
