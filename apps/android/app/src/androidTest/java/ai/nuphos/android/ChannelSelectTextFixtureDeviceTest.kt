package ai.nuphos.android

import android.content.Context
import android.content.ContextWrapper
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.Http
import ai.nuphos.android.data.TokenStore
import ai.nuphos.android.model.Team
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.session.AiAccess
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.chats.ChannelScreen
import ai.nuphos.android.ui.theme.NuphosTheme
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

/** Synthetic chat only: a post's menu offers Select Text, which makes its words selectable, as on iOS. Never touches a live API. */
@RunWith(AndroidJUnit4::class)
class ChannelSelectTextFixtureDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val token = "synthetic-chats-select"
    private val team = Team("aaaaaaaaaaaaaaaaaaaaaaaa", "Fixture A")
    private val listings = AtomicInteger()
    private val checks = AtomicInteger()
    @Volatile private var failFullReads = false
    @Volatile private var failChecks = false
    private val reads = CopyOnWriteArrayList<Int>()
    @Volatile private var messages = 1
    @Volatile private var running = false
    @Volatile private var answering = "chat-a"
    private lateinit var store: AgentStore
    private lateinit var auth: AuthSession
    private lateinit var tokens: TokenStore
    private lateinit var original: OkHttpClient
    private var savedAccess: Any? = null
    @Suppress("UNCHECKED_CAST") private fun access() = AiAccess::class.java.getDeclaredField("state")
        .also { it.isAccessible = true }.get(AiAccess) as MutableState<Any?>

    private fun detail(): String {
        val posts = (1..messages).joinToString(",") {
            """{"id":"p$it","role":"user","metadata":{"version":1,"sender":{"type":"agent","id":"agent-ops","displayName":"Release ops"},"sentAt":"2026-11-03T09:0$it:00Z","sourceSessionId":"agent-ops"},"parts":[{"type":"text","text":"Post $it"}]}"""
        }
        return """{"kind":"channel","title":"chat-a","transcriptUpdatedAt":"t$messages","messageCount":$messages,"activitySeq":$messages,"messages":[$posts]}"""
    }
    /** The agent is asked directly, so being past the first page of the agent list makes no difference. */
    private fun agent(): String {
        val run = if (running) ""","activeRun":{"streamId":"run-1"},"runtimeState":{"state":"active","schemaVersion":2,"phase":"working","channelIds":["$answering"]}""" else ""
        return """{"sessionId":"agent-ops","title":"Release ops","isOwner":true,"messages":[]$run}"""
    }

    @Before fun before() {
        val target = inst.targetContext
        val context = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chats-select-fixture", mode)
        }
        val field = Http::class.java.getDeclaredField("client").also { it.isAccessible = true }
        original = field.get(null) as OkHttpClient
        field.set(null, OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = request.url.encodedPath
            var code = 200
            val body = when {
                path.endsWith("/agent/conversations/chat-a") -> {
                    reads += messages
                    if (failFullReads && request.url.queryParameter("tail") != "1") { code = 500; "{}" } else detail()
                }
                path.endsWith("/agent/conversations/agent-ops") -> { checks.incrementAndGet(); if (failChecks) { code = 500; "{}" } else agent() }
                path.endsWith("/agents") -> """{"agents":[{"sessionId":"agent-ops","title":"Release ops"}]}"""
                path.endsWith("/agent/conversations") -> { if (request.url.queryParameter("kind") == null) listings.incrementAndGet(); """{"conversations":[],"hasMore":false}""" }
                path.endsWith("/read") -> """{"activitySeq":1,"readSeq":1,"unread":false}"""
                else -> "{}"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
                .body(body.toResponseBody(Http.jsonMedia)).build()
        }.build())
        val app = target.applicationContext as NuphosApplication
        val authContext = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("chats_select_fixture_$name", mode)
        }
        tokens = TokenStore(authContext)
        inst.runOnMainSync {
            savedAccess = access().value
            auth = AuthSession(app, tokens); auth.signOut()
            AiAccess.activate(token); AiAccess.grant(token)
            store = AgentStore(token, context)
            store.acceptMemberships(listOf(team), team.id)
        }
    }

    @After fun after() {
        inst.runOnMainSync {
            if (::store.isInitialized) store.disposeForConsent()
            if (::auth.isInitialized) auth.signOut()
            access().value = savedAccess
        }
        if (::tokens.isInitialized) tokens.clear()
        Http::class.java.getDeclaredField("client").also { it.isAccessible = true }.set(null, original)
    }

    private fun render() {
        compose.setContent {
            NuphosTheme {
                CompositionLocalProvider(LocalAgentStore provides store, LocalAuthSession provides auth) {
                    ChannelScreen("chat-a", onBack = { fail("The chat closed itself") })
                }
            }
        }
        compose.waitUntil(5_000) { compose.onAllNodesWithText("Post 1").fetchSemanticsNodes().isNotEmpty() }
    }
    private fun post() = compose.onNodeWithText("Post 1")
    private fun has(text: String) = compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
    private fun top(text: String) = compose.onNodeWithText(text).fetchSemanticsNode().boundsInRoot.top

    @Test fun theMenuOffersReplySelectTextAndCopyInThatOrder() {
        render()
        post().performTouchInput { longClick() }
        compose.waitUntil(3_000) { has("Select Text") }
        assertTrue(top("Reply") < top("Select Text"))
        assertTrue(top("Select Text") < top("Copy"))
    }

    @Test fun selectTextMakesTheWordsSelectableInsteadOfOpeningTheMenu() {
        render()
        compose.onAllNodesWithTag("post-selectable", useUnmergedTree = true).assertCountEquals(0)
        post().performTouchInput { longClick() }
        compose.waitUntil(3_000) { has("Select Text") }
        compose.onNodeWithText("Select Text").performClick()
        compose.waitUntil(3_000) { !has("Select Text") }
        compose.onNodeWithTag("post-selectable", useUnmergedTree = true).assertExists()
        // A long-press on the words now selects them: the post's menu stays shut.
        post().performTouchInput { longClick() }
        compose.waitForIdle()
        assertFalse("The menu doesn't open while selecting", has("Reply"))
        compose.onNodeWithTag("post-selectable", useUnmergedTree = true).assertExists()
    }

    @Test fun aTapEndsSelectingAndTheMenuComesBack() {
        render()
        post().performTouchInput { longClick() }
        compose.waitUntil(3_000) { has("Select Text") }
        compose.onNodeWithText("Select Text").performClick()
        compose.onNodeWithTag("post-selectable", useUnmergedTree = true).assertExists()
        // A tap on the post's row, outside its words.
        compose.onNodeWithTag("channel-avatar", useUnmergedTree = true).performClick()
        compose.waitUntil(3_000) { compose.onAllNodesWithTag("post-selectable", useUnmergedTree = true).fetchSemanticsNodes().isEmpty() }
        post().performTouchInput { longClick() }
        compose.waitUntil(3_000) { has("Reply") }
    }

    @Test fun selectTextIsAnAccessibilityActionToo() {
        render()
        val action = compose.onNode(hasAnyDescendant(hasText("Post 1")) and SemanticsMatcher("has Select Text") { node ->
            node.config.getOrElseNullable(androidx.compose.ui.semantics.SemanticsActions.CustomActions) { null }
                ?.any { it.label == "Select Text" } == true
        }, useUnmergedTree = true)
        val actions = action.fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsActions.CustomActions]
        compose.runOnIdle { actions.first { it.label == "Select Text" }.action() }
        compose.onNodeWithTag("post-selectable", useUnmergedTree = true).assertExists()
    }
}
